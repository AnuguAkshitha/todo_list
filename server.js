require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// PostgreSQL connection with SSL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false
  }
});

// Create table if not exists
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
  const result = await pool.query("SELECT * FROM tasks ORDER BY created_at ASC");
  res.json(result.rows);
});

// POST create task
app.post("/api/tasks", async (req, res) => {
  const { text, time } = req.body;
  const result = await pool.query(
    "INSERT INTO tasks (text, time) VALUES ($1, $2) RETURNING *",
    [text, time]
  );
  res.status(201).json(result.rows[0]);
});

// PUT update task
app.put("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  const { text, time, done } = req.body;
  const result = await pool.query(
    "UPDATE tasks SET text = COALESCE($1, text), time = COALESCE($2, time), done = COALESCE($3, done) WHERE id = $4 RETURNING *",
    [text, time, done, id]
  );
  res.json(result.rows[0]);
});

// DELETE task
app.delete("/api/tasks/:id", async (req, res) => {
  await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));