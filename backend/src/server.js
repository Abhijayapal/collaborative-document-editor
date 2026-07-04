// ============================================================
// server.js — Single entry point for the entire backend
//
// One HTTP server on PORT handles:
//   • Express   → REST API  (HTTP)
//   • Socket.IO → real-time events  (WS /socket.io/*)
//   • Yjs       → CRDT sync protocol (WS /yjs/*)
// ============================================================

import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";

import { setupYjsServer } from "../yjs-server.js";
import authRoutes       from "../routes/auth.js";
import documentRoutes   from "../routes/documents.js";
import snapshotRoutes   from "../routes/snapshots.js";

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const allowedOrigins = [
  "http://localhost:5173",
  FRONTEND_URL,
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, mobile apps)
      if (!origin) return callback(null, true);
      // Allow any vercel.app subdomain
      if (/\.vercel\.app$/.test(origin)) return callback(null, true);
      // Allow explicitly listed origins
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  const start = Date.now();
  res.on("finish", () => {
    console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// HTTP server — shared by Express, Socket.IO, and Yjs WebSockets
// ---------------------------------------------------------------------------
const server = http.createServer(app);


// ---------------------------------------------------------------------------
// Yjs WebSocket server (shares the same HTTP server — no second port)
// ---------------------------------------------------------------------------
setupYjsServer(server);

// ---------------------------------------------------------------------------
// REST API Routes
// ---------------------------------------------------------------------------
app.use("/auth",      authRoutes);
app.use("/documents", documentRoutes);
// Snapshot routes are nested: /documents/:id/snapshots
app.use("/documents/:id/snapshots", snapshotRoutes);

app.get("/", (_req, res) =>
  res.json({ status: "ok", message: "Collaborative Editor API" })
);
app.get("/health", (_req, res) =>
  res.json({ status: "healthy", uptime: process.uptime() })
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT) || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server started on port ${PORT}`);
  console.log(`   REST  → http://localhost:${PORT}/`);
  console.log(`   Auth  → http://localhost:${PORT}/auth/register|login`);
  console.log(`   Docs  → http://localhost:${PORT}/documents`);
  console.log(`   Yjs   → ws://localhost:${PORT}/yjs/<docId>\n`);
});

