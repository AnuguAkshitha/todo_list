require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("Connected to PostgreSQL!"))
  .catch(err => console.error("DB connection error:", err));

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      priority TEXT DEFAULT 'Low',
      date DATE NOT NULL,
      time TEXT NOT NULL,
      done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
})();

app.get("/api/tasks", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, text, date::text, time, priority, done, created_at as "createdAt" FROM tasks ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/tasks", async (req, res) => {
  const { text, time, priority, date } = req.body;
  if (!text || !time || !date) return res.status(400).json({ error: "Text, date and time are required" });
  try {
    const result = await pool.query(
      `INSERT INTO tasks (text, time, priority, date) VALUES ($1, $2, $3, $4)
       RETURNING id, text, date::text, time, priority, done, created_at as "createdAt"`,
      [text, time, priority || "Low", date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/tasks/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { text, time, priority, done, date } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET text = COALESCE($1, text),
           time = COALESCE($2, time),
           priority = COALESCE($3, priority),
           done = COALESCE($4, done),
           date = COALESCE($5, date)
       WHERE id = $6
       RETURNING id, text, date::text, time, priority, done, created_at as "createdAt"`,
      [text ?? null, time ?? null, priority ?? null, done ?? null, date ?? null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Task not found" });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/tasks/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query("DELETE FROM tasks WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Task not found" });
    res.sendStatus(204);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));