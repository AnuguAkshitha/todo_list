require("dotenv").config();
const express  = require("express");
const { Pool } = require("pg");
const cors     = require("cors");
const path     = require("path");
const webpush  = require("web-push");
const cron     = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     process.env.DB_PORT,
  ssl:      { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("Connected to PostgreSQL!"))
  .catch(err => console.error("DB connection error:", err));

// ── Create tables + migrate user_id to TEXT if it was INTEGER ─────────────────
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL DEFAULT '',
      text       TEXT NOT NULL,
      priority   TEXT DEFAULT 'Low',
      date       DATE NOT NULL,
      time       TEXT NOT NULL,
      done       BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      user_id      TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      updated_at   TIMESTAMP DEFAULT NOW()
    );
  `);

  // Migration: if user_id column is still integer type from an old run, convert it to TEXT
  try {
    const colType = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'tasks' AND column_name = 'user_id'
    `);
    if (colType.rows.length > 0 && colType.rows[0].data_type !== 'text') {
      console.log("Migrating tasks.user_id column from", colType.rows[0].data_type, "to TEXT...");
      await pool.query(`ALTER TABLE tasks ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT`);
      console.log("Migration complete.");
    }
  } catch (migErr) {
    console.error("Migration check error:", migErr.message);
  }
})();

// ── VAPID setup ───────────────────────────────────────────────────────────────
webpush.setVapidDetails(
  "mailto:admin@todoapp.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Middleware: extract userId from header ────────────────────────────────────
function requireUserId(req, res, next) {
  const userId = req.headers["x-user-id"];
  if (!userId) return res.status(400).json({ error: "Missing x-user-id header" });
  req.userId = userId;
  next();
}

// ── Route: expose VAPID public key to client ──────────────────────────────────
app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── Route: save push subscription ────────────────────────────────────────────
app.post("/api/subscribe", requireUserId, async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO push_subscriptions (user_id, subscription, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) DO UPDATE SET subscription = $2, updated_at = NOW()
    `, [req.userId, JSON.stringify(req.body)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tasks: GET ────────────────────────────────────────────────────────────────
app.get("/api/tasks", requireUserId, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, text, date::text, time, priority, done, created_at as "createdAt"
       FROM tasks WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tasks: POST ───────────────────────────────────────────────────────────────
app.post("/api/tasks", requireUserId, async (req, res) => {
  const { text, time, priority, date } = req.body;
  if (!text || !time || !date)
    return res.status(400).json({ error: "Text, date and time are required" });
  try {
    const result = await pool.query(
      `INSERT INTO tasks (user_id, text, time, priority, date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, text, date::text, time, priority, done, created_at as "createdAt"`,
      [req.userId, text, time, priority || "Low", date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tasks: PATCH ──────────────────────────────────────────────────────────────
app.patch("/api/tasks/:id", requireUserId, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { text, time, priority, done, date } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET text     = COALESCE($1, text),
           time     = COALESCE($2, time),
           priority = COALESCE($3, priority),
           done     = COALESCE($4, done),
           date     = COALESCE($5, date)
       WHERE id = $6 AND user_id = $7
       RETURNING id, text, date::text, time, priority, done, created_at as "createdAt"`,
      [text??null, time??null, priority??null, done??null, date??null, id, req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Task not found" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tasks: DELETE ─────────────────────────────────────────────────────────────
app.delete("/api/tasks/:id", requireUserId, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      "DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Task not found" });
    res.sendStatus(204);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cron: send Web Push to each user for their due tasks (every minute) ───────
cron.schedule("* * * * *", async () => {
  try {
    const now  = new Date();
    const hh   = now.getHours().toString().padStart(2, "0");
    const mm   = now.getMinutes().toString().padStart(2, "0");
    const today = now.toISOString().slice(0, 10);
    const currentTime = `${hh}:${mm}`;

    const result = await pool.query(`
      SELECT t.id, t.text, t.user_id, ps.subscription
      FROM tasks t
      JOIN push_subscriptions ps ON t.user_id = ps.user_id
      WHERE t.done = false
        AND t.date::text = $1
        AND SUBSTRING(t.time, 1, 5) = $2
    `, [today, currentTime]);

    for (const row of result.rows) {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({ id: row.id, text: row.text })
        );
        console.log(`Push sent to user ${row.user_id} for task: ${row.text}`);
      } catch (pushErr) {
        console.error(`Push failed for user ${row.user_id}:`, pushErr.message);
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1", [row.user_id]);
        }
      }
    }
  } catch (err) {
    console.error("Cron error:", err);
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));