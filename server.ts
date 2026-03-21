import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("nexus.db");
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    category TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS health_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_name TEXT NOT NULL,
    age INTEGER,
    sport TEXT,
    vitals TEXT, -- JSON string of vitals
    analysis TEXT,
    status TEXT, -- 'Ready', 'Caution', 'Suspicious'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_reports_athlete ON health_reports(athlete_name);
  CREATE INDEX IF NOT EXISTS idx_reports_created ON health_reports(created_at);
  CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/notes", (req, res) => {
    const notes = db.prepare("SELECT * FROM notes ORDER BY created_at DESC").all();
    res.json(notes);
  });

  app.post("/api/notes", (req, res) => {
    const { title, content, category } = req.body;
    const info = db.prepare("INSERT INTO notes (title, content, category) VALUES (?, ?, ?)").run(title, content, category || 'General');
    res.json({ id: info.lastInsertRowid, title, content, category });
  });

  app.delete("/api/notes/:id", (req, res) => {
    db.prepare("DELETE FROM notes WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Health Report Routes
  app.get("/api/reports", (req, res) => {
    const reports = db.prepare("SELECT * FROM health_reports ORDER BY created_at DESC").all();
    res.json(reports);
  });

  app.post("/api/reports", (req, res) => {
    const { athlete_name, age, sport, vitals, analysis, status } = req.body;
    const vitalsStr = typeof vitals === 'string' ? vitals : JSON.stringify(vitals);
    const info = db.prepare(`
      INSERT INTO health_reports (athlete_name, age, sport, vitals, analysis, status) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(athlete_name, age, sport, vitalsStr, analysis, status);
    res.json({ id: info.lastInsertRowid, athlete_name, status });
  });

  app.delete("/api/reports/:id", (req, res) => {
    db.prepare("DELETE FROM health_reports WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/reports/bulk", (req, res) => {
    const reports = req.body;
    if (!Array.isArray(reports)) {
      return res.status(400).json({ error: "Expected an array of reports" });
    }

    const insert = db.prepare(`
      INSERT INTO health_reports (athlete_name, age, sport, vitals, analysis, status) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((data) => {
      for (const report of data) {
        const { athlete_name, age, sport, vitals, analysis, status } = report;
        const vitalsStr = typeof vitals === 'string' ? vitals : JSON.stringify(vitals);
        insert.run(athlete_name, age, sport, vitalsStr, analysis, status);
      }
    });

    try {
      transaction(reports);
      res.json({ success: true, count: reports.length });
    } catch (err) {
      console.error("Bulk insert error:", err);
      res.status(500).json({ error: "Failed to perform bulk insert" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexus AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
