// server.js

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend files from 'public' folder
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// PostgreSQL connection using environment variables
const pool = new Pool({
  user: process.env.DB_USER || "Akshitha",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "todoapp",
  password: process.env.DB_PASSWORD || "", // your local password
  port: process.env.DB_PORT || 5432,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// Test DB connection
pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL!"))
  .catch(err => console.error("❌ DB connection error:", err));

// Create table if it doesn't exist
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      time TEXT NOT NULL,
      done BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
})();

// GET all tasks
app.get("/api/tasks", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tasks ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create task
app.post("/api/tasks", async (req, res) => {
  try {
    const { text, time } = req.body;
    const result = await pool.query(
      "INSERT INTO tasks (text, time) VALUES ($1, $2) RETURNING *",
      [text, time]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update task (complete or edit)
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { text, time, done } = req.body;
    const result = await pool.query(
      "UPDATE tasks SET text = COALESCE($1, text), time = COALESCE($2, time), done = COALESCE($3, done) WHERE id = $4 RETURNING *",
      [text, time, done, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a task
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamic port for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));