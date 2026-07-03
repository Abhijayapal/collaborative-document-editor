import "dotenv/config"; // must be first — loads .env before anything else
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import Redis from "ioredis";

import "./db.js";
import Doc from "./models/Document.js";
import Snapshot from "./models/Snapshot.js";
import { pruneOldSnapshots } from "./routes/snapshots.js";

// ---------------------------------------------------------------------------
// Message type constants (Yjs wire protocol)
// ---------------------------------------------------------------------------
const MSG_SYNC      = 0; // document sync (step1, step2, update)
const MSG_AWARENESS = 1; // cursor positions, user presence

// ---------------------------------------------------------------------------
// Redis — optional, used only for horizontal scaling (pub/sub across servers).
// Server works fine without Redis for single-instance local dev.
// ---------------------------------------------------------------------------
const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT) || 6379,
  lazyConnect:          true,  // don't auto-connect on creation
  maxRetriesPerRequest: null,  // don't throw MaxRetriesPerRequestError
  retryStrategy:        () => null, // never retry — fail fast and stay down
  enableOfflineQueue:   false, // don't queue commands when disconnected
};

const pub = new Redis(redisConfig);
const sub = new Redis(redisConfig);
let redisReady = false; // guard flag — all Redis calls check this first

pub.on("connect", () => { redisReady = true;  console.log("✅ Redis pub connected"); });
pub.on("close",   () => { redisReady = false; });
pub.on("error",   () => {}); // swallow all errors — handled by redisReady flag
sub.on("error",   () => {}); // same for sub

sub.on("connect", () => {
  console.log("✅ Redis sub connected");
  sub.subscribe("doc-updates").catch(() => {});
});

// Non-fatal connection attempt
pub.connect().catch(() => console.warn("⚠️  Redis unavailable — single-instance mode (no horizontal scaling)"));
sub.connect().catch(() => {});

// Doc is imported from ./models/Document.js — shared with REST routes

// ---------------------------------------------------------------------------
// In-memory store: docId → { ydoc, awareness, conns Set, saveTimer }
// ---------------------------------------------------------------------------
const documents = new Map();

/**
 * Load (or create) a Yjs document for the given docId.
 *
 * On first load:
 *   - Restores binary CRDT state from MongoDB
 *   - Registers an 'update' listener that publishes to Redis
 *     (so OTHER backend servers receive and apply the same update)
 *   - Starts a 5-second periodic save to MongoDB
 */
const getOrCreateDoc = async (docId) => {
  if (documents.has(docId)) return documents.get(docId);

  const ydoc      = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(ydoc);

  // 1. Restore persisted state from MongoDB (document was created via REST API)
  const saved = await Doc.findById(docId);
  if (saved?.data) {
    Y.applyUpdate(ydoc, new Uint8Array(saved.data));
    console.log(`📂 Loaded doc "${docId}" from MongoDB`);
  }

  // 2. On every CRDT update → forward to all OTHER clients on this server,
  //    then publish to Redis for cross-server horizontal scaling.
  //
  //    IMPORTANT: `origin` is the WebSocket conn object that sent the update,
  //    or "redis" when the update arrived from the Redis subscriber.
  //    We skip sending back to the originating conn (they already have it),
  //    and we skip the Redis publish for updates that arrived FROM Redis
  //    (to avoid infinite pub/sub loops).
  ydoc.on("update", (update, origin) => {
    // ── Direct broadcast to every other client on this server ────────────
    const currentEntry = documents.get(docId);
    if (currentEntry) {
      const encoded = encodeUpdateMsg(update);
      currentEntry.conns.forEach((c) => {
        if (c !== origin && c.readyState === c.OPEN) {
          c.send(encoded);
        }
      });
    }

    // ── Redis publish for multi-server horizontal scaling ─────────────────
    // Skip if: update came FROM Redis (would cause infinite loop)
    //       or: Redis is not connected (single-instance mode)
    if (origin === "redis" || !redisReady) return;
    pub.publish(
      "doc-updates",
      JSON.stringify({ docId, update: Array.from(update) })
    ).catch(() => {});
  });

  // 3. Periodic MongoDB persistence every 5 seconds
  const saveTimer = setInterval(async () => {
    const state = Y.encodeStateAsUpdate(ydoc);
    await Doc.findByIdAndUpdate(docId, { data: Buffer.from(state) });
    console.log(`💾 Saved doc "${docId}" to MongoDB`);
  }, 5000);

  // 4. Auto-snapshot every 5 minutes
  const snapshotTimer = setInterval(async () => {
    try {
      const state = Y.encodeStateAsUpdate(ydoc);
      await pruneOldSnapshots(docId);
      await Snapshot.create({ docId, data: Buffer.from(state), label: "Auto-save" });
      console.log(`📸 Auto-snapshot saved for doc "${docId}"`);
    } catch (e) {
      console.error("Snapshot error:", e.message);
    }
  }, 5 * 60 * 1000);

  const entry = { ydoc, awareness, conns: new Set(), saveTimer, snapshotTimer };
  documents.set(docId, entry);
  return entry;
};

// ---------------------------------------------------------------------------
// Redis subscriber — receive updates published by OTHER servers
// ---------------------------------------------------------------------------
// Only subscribe if Redis connected; swallow error so server stays alive without Redis
sub.on("connect", () => {
  sub.subscribe("doc-updates").catch((e) => console.error("Redis subscribe error:", e.message));
});

sub.on("message", (_channel, message) => {
  const { docId, update } = JSON.parse(message);
  const entry = documents.get(docId);
  if (!entry) return; // this server doesn't hold that doc right now

  // Apply with origin="redis" so the update listener skips re-publishing
  Y.applyUpdate(entry.ydoc, new Uint8Array(update), "redis");

  // Forward the update to all WS clients connected to THIS server
  const encoded = encodeUpdateMsg(new Uint8Array(update));
  entry.conns.forEach((conn) => {
    if (conn.readyState === conn.OPEN) conn.send(encoded);
  });
});

// ---------------------------------------------------------------------------
// Yjs wire-protocol helpers
// ---------------------------------------------------------------------------

/** Wrap a raw Yjs update in a sync-message envelope */
function encodeUpdateMsg(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** Encode sync step-1: send our state vector so the client knows what to send us */
function encodeSyncStep1(ydoc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return encoding.toUint8Array(encoder);
}

// ---------------------------------------------------------------------------
// Connection handler — called by server.js for each incoming Yjs WS upgrade
// ---------------------------------------------------------------------------
async function handleYjsConnection(conn, req) {
  // docId comes from the URL path: ws://host:PORT/yjs/<docId>
  // Strip the /yjs/ prefix added by the router in server.js
  const rawPath = req.url.replace(/^\/yjs\/?/, "");
  const docId   = decodeURIComponent(rawPath) || "default";

  const { ydoc, awareness, conns } = await getOrCreateDoc(docId);
  conns.add(conn);
  console.log(`🔌 Client connected to doc "${docId}" (${conns.size} active)`);

  // Initiate sync: send step-1 (our state vector) to the client
  // Client replies with step-2 (missing updates) + its own step-1
  conn.send(encodeSyncStep1(ydoc));

  conn.on("message", (rawMsg) => {
    try {
      const msg     = new Uint8Array(rawMsg);
      const decoder = decoding.createDecoder(msg);
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);

        // readSyncMessage handles all three sub-types automatically:
        //   messageYjsSyncStep1 → replies with syncStep2
        //   messageYjsSyncStep2 → applies the update
        //   messageYjsUpdate    → applies update (triggers ydoc 'update' → Redis)
        syncProtocol.readSyncMessage(decoder, encoder, ydoc, conn);

        // Send the reply if there is one (syncStep2 in response to step1)
        if (encoding.length(encoder) > 1) {
          conn.send(encoding.toUint8Array(encoder));
        }
      } else if (msgType === MSG_AWARENESS) {
        // Forward raw awareness bytes to all other clients in this doc
        conns.forEach((c) => {
          if (c !== conn && c.readyState === c.OPEN) c.send(rawMsg);
        });
        // Apply locally so the server tracks current awareness state
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
      }
    } catch (err) {
      console.error(`⚠️  Message parse error on doc "${docId}":`, err.message);
    }
  });

  conn.on("close", () => {
    conns.delete(conn);
    console.log(
      `🔌 Client disconnected from "${docId}" (${conns.size} remaining)`
    );
    // Clean up awareness state for this client
    awarenessProtocol.removeAwarenessStates(
      awareness,
      [conn.clientID],
      "disconnect"
    );
    // Unload from memory when last client leaves
    if (conns.size === 0) {
      const entry = documents.get(docId);
      if (entry) {
        clearInterval(entry.saveTimer);
        clearInterval(entry.snapshotTimer);
        // ── CRITICAL: final save before unloading ──────────────────────────
        // The periodic timer runs every 5s, so edits made in the last 0–5s
        // would be lost without this final flush.
        // Wrap in async IIFE — conn.on("close") is synchronous, can't use await directly.
        (async () => {
          try {
            const state = Y.encodeStateAsUpdate(entry.ydoc);
            await Doc.findByIdAndUpdate(docId, { data: Buffer.from(state) });
            console.log(`💾 Final save for doc "${docId}"`);
          } catch (e) {
            console.error(`⚠️  Final save failed for "${docId}":`, e.message);
          }
        })();
        documents.delete(docId);
        console.log(`🧹 Unloaded doc "${docId}" from memory`);
      }
    }
  });

  conn.on("error", (err) => {
    console.error(`⚠️  WS error on doc "${docId}":`, err.message);
    conns.delete(conn);
  });
}

// ---------------------------------------------------------------------------
// setupYjsServer — attach Yjs WebSocket handling to an existing HTTP server.
//
// Uses noServer: true so that the WebSocketServer does NOT open its own port.
// Instead, server.js routes the HTTP "upgrade" event here for /yjs/* paths,
// keeping everything on a single port.
// ---------------------------------------------------------------------------
export function setupYjsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Route WebSocket upgrade requests: /yjs/* → Yjs, others → Socket.IO
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/yjs")) {
      wss.handleUpgrade(req, socket, head, (conn) => {
        wss.emit("connection", conn, req);
      });
      // All other upgrade requests (e.g. /socket.io/) are left alone
      // and handled by Socket.IO's own listener on the same httpServer.
    }
  });

  wss.on("connection", handleYjsConnection);

  console.log("✅ Yjs WebSocket handler attached (shares port with HTTP server)");
}
