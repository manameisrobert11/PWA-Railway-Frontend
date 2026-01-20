import express from "express";
import http from "http";
import cors from "cors";
import mysql from "mysql2/promise";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] }
});

app.use(cors());
app.use(express.json());

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 10000;

const DB_CONFIG = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: process.env.MYSQL_SSL === "true"
};

/* ================= STATE ================= */

let pool;
let dbReady = false;
const offlineQueue = [];

/* ================= DB ================= */

async function connectDb() {
  for (let i = 1; i <= 12; i++) {
    try {
      pool = mysql.createPool({
        ...DB_CONFIG,
        connectionLimit: 10,
        waitForConnections: true
      });
      await pool.query("SELECT 1");
      dbReady = true;
      console.log("✅ DB ready");
      flushOffline();
      return;
    } catch (e) {
      console.log(`DB not ready (${i}/12)`, e.code);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function flushOffline() {
  while (offlineQueue.length && dbReady) {
    const job = offlineQueue.shift();
    try {
      await pool.query(job.sql, job.values);
    } catch {
      offlineQueue.unshift(job);
      break;
    }
  }
}

function safeQuery(sql, values) {
  if (!dbReady) {
    offlineQueue.push({ sql, values });
    return { queued: true };
  }
  return pool.query(sql, values);
}

function table(mode) {
  return mode === "alt" ? "staged_alt" : "staged";
}

/* ================= HEALTH ================= */

app.get("/api/health", (_req, res) => {
  res.status(dbReady ? 200 : 503).json({
    ok: dbReady,
    queued: offlineQueue.length
  });
});

/* ================= GET ================= */

app.get("/api/staged", async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM staged ORDER BY id DESC LIMIT 200"
  );
  res.json(rows);
});

app.get("/api/staged-alt", async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM staged_alt ORDER BY id DESC LIMIT 200"
  );
  res.json(rows);
});

app.get("/api/staged/count", async (_req, res) => {
  const [[r]] = await pool.query("SELECT COUNT(*) c FROM staged");
  res.json({ count: r.c });
});

app.get("/api/staged-alt/count", async (_req, res) => {
  const [[r]] = await pool.query("SELECT COUNT(*) c FROM staged_alt");
  res.json({ count: r.c });
});

/* ================= EXISTS ================= */

app.get("/api/exists/:serial", async (req, res) => {
  const [[r]] = await pool.query(
    "SELECT id FROM staged WHERE serial=? LIMIT 1",
    [req.params.serial]
  );
  res.json({ exists: !!r });
});

app.get("/api/exists-alt/:serial", async (req, res) => {
  const [[r]] = await pool.query(
    "SELECT id FROM staged_alt WHERE serial=? LIMIT 1",
    [req.params.serial]
  );
  res.json({ exists: !!r });
});

/* ================= INSERT ================= */

function insertSQL(t) {
  return `
    INSERT INTO ${t}
    (serial,wagonId1,wagonId2,wagonId3,operator,receivedAt,loadedAt,
     destination,grade,railType,spec,lengthM,timestamp)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;
}

app.post("/api/scan", async (req, res) => {
  await safeQuery(insertSQL("staged"), Object.values(req.body));
  io.emit("new-scan", req.body);
  res.json({ ok: true });
});

app.post("/api/scan-alt", async (req, res) => {
  await safeQuery(insertSQL("staged_alt"), Object.values(req.body));
  io.emit("new-scan-alt", req.body);
  res.json({ ok: true });
});

/* ================= BULK ================= */

app.post("/api/scans/bulk", async (req, res) => {
  for (const row of req.body) {
    await safeQuery(insertSQL("staged"), Object.values(row));
  }
  io.emit("bulk-sync");
  res.json({ ok: true });
});

app.post("/api/scans-alt/bulk", async (req, res) => {
  for (const row of req.body) {
    await safeQuery(insertSQL("staged_alt"), Object.values(row));
  }
  io.emit("bulk-sync-alt");
  res.json({ ok: true });
});

/* ================= DELETE ================= */

app.delete("/api/staged/:id", async (req, res) => {
  await safeQuery("DELETE FROM staged WHERE id=?", [req.params.id]);
  io.emit("deleted-scan", req.params.id);
  res.json({ ok: true });
});

app.delete("/api/staged-alt/:id", async (req, res) => {
  await safeQuery("DELETE FROM staged_alt WHERE id=?", [req.params.id]);
  io.emit("deleted-scan-alt", req.params.id);
  res.json({ ok: true });
});

/* ================= CLEAR ================= */

app.post("/api/staged/clear", async (_req, res) => {
  await safeQuery("DELETE FROM staged");
  io.emit("cleared-scans");
  res.json({ ok: true });
});

app.post("/api/staged-alt/clear", async (_req, res) => {
  await safeQuery("DELETE FROM staged_alt");
  io.emit("cleared-scans-alt");
  res.json({ ok: true });
});

/* ================= EXPORT (HOOKS) ================= */

app.post("/api/export-to-excel", (_req, res) =>
  res.json({ ok: true, message: "Handled client-side" })
);

app.post("/api/export-alt-to-excel", (_req, res) =>
  res.json({ ok: true })
);

app.post("/api/export-xlsx-images", (_req, res) =>
  res.json({ ok: true })
);

app.post("/api/export-alt-xlsx-images", (_req, res) =>
  res.json({ ok: true })
);

/* ================= SOCKET ================= */

io.on("connection", socket => {
  console.log("🔌 Socket connected", socket.id);
});

/* ================= START ================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend live on :${PORT}`);
});

connectDb();
