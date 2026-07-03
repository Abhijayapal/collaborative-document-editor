# CollabDocs — Real-Time Collaborative Document Editor

A production-inspired collaborative document editor built on the MERN stack with CRDT-based synchronization, Redis Pub/Sub for horizontal scaling, and WebSocket communication. Designed to demonstrate distributed systems architecture and real-time consistency guarantees at scale.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Key Features](#key-features)
- [Architecture Overview](#architecture-overview)
- [System Design Flow](#system-design-flow)
- [Data Flow — Concurrent Editing](#data-flow--concurrent-editing)
- [Tech Stack](#tech-stack)
- [Why CRDT over Operational Transformation](#why-crdt-over-operational-transformation)
- [Redis Pub/Sub — Multi-Instance Communication](#redis-pubsub--multi-instance-communication)
- [Horizontal Scaling](#horizontal-scaling)
- [Authentication Flow](#authentication-flow)
- [Folder Structure](#folder-structure)
- [API Endpoints](#api-endpoints)
- [WebSocket Protocol](#websocket-protocol)
- [Performance Considerations](#performance-considerations)
- [Challenges Faced](#challenges-faced)
- [Future Improvements](#future-improvements)
- [Learning Outcomes](#learning-outcomes)
- [Local Development](#local-development)

---

## Project Overview

### The Problem

Real-time collaborative editing appears simple on the surface — multiple users editing the same document simultaneously. In practice, it is one of the harder distributed systems problems because:

- **Network latency is non-zero and unpredictable.** Two users may send conflicting edits at the same millisecond, but the server receives them in different orders.
- **State divergence.** Without a consistency protocol, applying User A's edit on top of User B's out-of-order edit produces corrupted, divergent document states on each client.
- **Operational ordering.** Edits are positional — inserting a character at index 5 means something different after another user has inserted characters before it.
- **Presence and awareness.** Displaying who is editing where (live cursors) requires low-latency broadcast of ephemeral state that does not need persistence.

### How This Project Solves It

This project uses **Yjs**, a high-performance CRDT (Conflict-free Replicated Data Type) library, as the core synchronization engine. CRDTs provide mathematical guarantees that concurrent operations, applied in any order on any replica, will always converge to the same final state — without a central arbiter.

The architecture separates concerns cleanly:
- The CRDT layer handles document consistency.
- The WebSocket layer handles real-time transport.
- Redis Pub/Sub handles cross-instance message fanout for horizontal scaling.
- MongoDB provides durable persistence of binary CRDT state.

---

## Key Features

- Real-time multi-user collaborative editing with automatic conflict resolution
- Live cursor and user presence tracking via Yjs awareness protocol
- JWT-based stateless authentication with bcrypt password hashing
- Persistent document storage using binary-encoded Yjs state (not plain text)
- Automatic document save every 5 seconds with a final flush on disconnect
- Version history via periodic snapshots (every 5 minutes, capped at 20 per document)
- Snapshot restore — roll back any document to a previous state
- Shareable document links — any authenticated user can collaborate on a shared document
- Owner-restricted rename and delete operations
- Horizontal scaling via Redis Pub/Sub across multiple Node.js instances
- Graceful degradation — server operates in single-instance mode without Redis

---

## Architecture Overview

```
+------------------+        +------------------+
|   Browser A      |        |   Browser B      |
|  React + TipTap  |        |  React + TipTap  |
|  Yjs Provider    |        |  Yjs Provider    |
+--------+---------+        +--------+---------+
         |                           |
         |   WebSocket (Binary Yjs)  |
         |                           |
+--------+---------------------------+--------+
|              Load Balancer (Nginx)           |
+--------+---------------------------+--------+
         |                           |
+--------+---------+       +---------+--------+
|  Node.js         |       |  Node.js         |
|  Instance A      |       |  Instance B      |
|  Express + ws    |       |  Express + ws    |
+--------+---------+       +---------+--------+
         |                           |
         +----------+  +-------------+
                    |  |
            +-------+--+-------+
            |  Redis Pub/Sub   |
            |  (doc-updates)   |
            +-------+----------+
                    |
            +-------+----------+
            |   MongoDB Atlas  |
            |  (binary Yjs     |
            |   state + meta)  |
            +------------------+
```

When User A (on Instance A) makes an edit:
1. The Yjs update is applied locally and broadcast to all peers on Instance A via in-memory WebSocket fanout.
2. The update is published to the Redis `doc-updates` channel.
3. Instance B receives the Redis message and broadcasts it to all peers connected to it.
4. Both instances periodically flush the CRDT state to MongoDB.

---

## System Design Flow

```
User types a character
        |
        v
TipTap editor captures the input
        |
        v
Yjs generates a binary CRDT update
(encodes the operation as a position-independent delta)
        |
        v
y-websocket sends the binary update over WebSocket
        |
        v
Node.js WebSocket server receives the raw binary frame
        |
        v
lib0 decodes the message type (sync / awareness)
        |
        v
y-protocols/sync applies the update to the server-side Ydoc
        |
        v
Ydoc fires an 'update' event
        |
        +-------> Broadcast to all other WebSocket connections on this instance
        |
        +-------> Publish to Redis 'doc-updates' channel (if Redis connected)
        |
        v
Redis subscriber on all other instances receives the message
        |
        v
Each instance applies the update to its local Ydoc copy
and broadcasts to its connected WebSocket clients
        |
        v
Each client's Yjs provider receives the update
and merges it into the local document (CRDT convergence)
        |
        v
TipTap re-renders the affected portion of the document
```

---

## Data Flow — Concurrent Editing

**Scenario:** User A (connected to Instance A) and User B (connected to Instance B) both type at position 10 simultaneously.

1. User A types "X" at position 10. Yjs generates update `UA`.
2. User B types "Y" at position 10. Yjs generates update `UB`.
3. Instance A applies `UA` locally, broadcasts to Instance A peers, publishes `UA` to Redis.
4. Instance B applies `UB` locally, broadcasts to Instance B peers, publishes `UB` to Redis.
5. Instance A receives `UB` from Redis, applies it. Instance B receives `UA` from Redis, applies it.
6. Both instances now have both updates applied.
7. Because Yjs uses a CRDT (specifically a YATA-based sequence CRDT), `UA` and `UB` commute — applying them in either order produces identical state.
8. Both browsers receive the counterpart update, merge it, and display the same final document: "XY" or "YX" (deterministically resolved by Yjs based on client IDs, not timing).

**Consistency guarantee:** Strong eventual consistency. All replicas converge to the same state once all updates are delivered, regardless of delivery order.

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 19 | UI framework |
| TipTap v2 | Rich text editor (ProseMirror-based) |
| @tiptap/extension-collaboration | Yjs ↔ TipTap binding |
| @tiptap/extension-collaboration-cursor | Live cursor rendering via awareness |
| y-websocket | Yjs WebSocket provider (client-side) |
| React Router v7 | Client-side routing |
| Tailwind CSS | Utility-first styling |

### Backend
| Technology | Purpose |
|---|---|
| Node.js | Runtime |
| Express.js | HTTP REST API |
| ws | Raw WebSocket server for Yjs protocol |
| Yjs | CRDT engine — document state management |
| y-protocols | Yjs sync and awareness binary protocol |
| lib0 | Binary encoder/decoder for Yjs wire format |
| ioredis | Redis client (Pub/Sub) |
| Mongoose | MongoDB ODM |

### Database
| Technology | Purpose |
|---|---|
| MongoDB Atlas | Document storage — binary Yjs state + metadata |

### Real-time Communication
| Technology | Purpose |
|---|---|
| WebSocket (ws) | Bidirectional binary transport |
| Yjs awareness protocol | Ephemeral presence state (cursors, user info) |
| Redis Pub/Sub | Cross-instance update fanout |

### Authentication
| Technology | Purpose |
|---|---|
| jsonwebtoken | Stateless JWT generation and verification |
| bcryptjs | Password hashing (cost factor 12) |

### Deployment
| Technology | Purpose |
|---|---|
| Docker | Containerization |
| dotenv | Environment variable management |

---

## Why CRDT over Operational Transformation

### Operational Transformation (OT)
OT was the original approach used by Google Docs. It works by transforming operations against concurrent operations to account for positional shifts.

**Problems with OT at scale:**
- Requires a central server to impose a total ordering of operations. Every client must go through the server to have its operations transformed — this is an architectural bottleneck.
- The transformation functions become extremely complex as the number of concurrent operation types grows (insert, delete, format, undo, etc.).
- Undo in OT is non-trivial and error-prone.
- Peer-to-peer OT (without a central server) is an unsolved problem for the general case.

### CRDTs (Conflict-free Replicated Data Types)
CRDTs provide a different mathematical foundation. Operations are designed to be commutative and idempotent by construction.

**Advantages:**
- No central ordering authority required. Updates can be applied in any order on any replica and will converge to the same state.
- Scales naturally to peer-to-peer and multi-server architectures.
- Network partition resilience — clients can continue editing offline and merge when reconnected.
- Simpler reasoning about correctness: commutativity and idempotency are algebraic properties, not case-by-case transformation rules.

**Trade-offs:**
- CRDT state can grow over time (tombstones for deleted characters are retained). Yjs mitigates this with garbage collection.
- Higher memory usage per document compared to a simple text string.
- Initial implementation complexity is higher — the CRDT library must be chosen carefully.

**Decision:** Yjs's YATA (Yet Another Transformation Approach) algorithm provides excellent performance characteristics (O(1) insert complexity in most cases) and has proven production use in editors like Jupyter, Gitpod, and Liveblocks.

---

## Redis Pub/Sub — Multi-Instance Communication

### The Problem

WebSocket connections are stateful and sticky. When User A connects to Instance A and User B connects to Instance B, Instance A has no direct knowledge of User B's WebSocket connection. An update received by Instance A cannot be forwarded to User B without an out-of-band communication channel.

### The Solution

Redis Pub/Sub acts as a message bus between instances. Every instance publishes Yjs updates to a shared `doc-updates` channel. Every instance subscribes to the same channel and forwards incoming messages to its locally connected WebSocket clients.

```
Instance A receives update from User A
    |
    +---> Broadcast to local peers (in-memory)
    |
    +---> PUBLISH doc-updates { docId, update: Uint8Array }
                    |
              Redis broker
                    |
            +-------+-------+
            |               |
    Instance B          Instance C
    (subscribes)        (subscribes)
            |               |
    Forward to          Forward to
    local peers         local peers
```

### Graceful Degradation

The server checks `redisReady` before publishing. If Redis is unavailable (e.g., local development without Redis), the server operates in single-instance mode. All users connected to the same instance still see real-time updates via in-memory broadcast. Only cross-instance synchronization is lost.

---

## Horizontal Scaling

The application is designed to scale horizontally with minimal changes:

1. **Stateless REST API.** JWT authentication carries all identity information in the token. No server-side session state. Any instance can serve any REST request.

2. **WebSocket stickiness.** Load balancers should route WebSocket connections from the same user to the same instance for the duration of the connection. This is standard Nginx configuration using `upstream` with `ip_hash`.

3. **CRDT mergeability.** Because Yjs updates are commutative, it does not matter which instance a user connects to. Updates received from Redis are applied identically regardless of order.

4. **Shared persistence.** All instances read from and write to the same MongoDB collection. On first connection to a document, an instance loads the latest state from MongoDB and constructs a Yjs document in memory.

5. **Memory isolation.** Each instance holds only the documents that currently have active connections. When the last user disconnects, the document is flushed to MongoDB and removed from memory.

---

## Authentication Flow

```
Client                          Server
  |                               |
  |-- POST /auth/register ------> |
  |   { username, password }      |
  |                               | bcrypt.hash(password, 12)
  |                               | User.create({ username, hash })
  |                               | jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' })
  |<-- 201 { token, user } ------ |
  |                               |
  | (store token in localStorage) |
  |                               |
  |-- GET /documents -----------> |
  |   Authorization: Bearer <jwt> |
  |                               | jwt.verify(token, JWT_SECRET)
  |                               | req.user = { id, username }
  |<-- 200 [ ...docs ] ---------- |
```

**Token verification** happens in the `protect` middleware applied to all `/documents` and `/documents/:id/snapshots` routes. The middleware rejects requests with missing, malformed, or expired tokens with HTTP 401.

**WebSocket connections** are not individually authenticated at the protocol level (a known trade-off for simplicity). The document ID in the URL provides implicit access scoping. Production hardening would involve passing the JWT as a query parameter during the WebSocket upgrade and verifying it in `handleUpgrade`.

---

## Folder Structure

```
editor/
├── backend/
│   ├── src/
│   │   └── server.js              # HTTP server entry point
│   ├── routes/
│   │   ├── auth.js                # POST /auth/register, /auth/login
│   │   ├── documents.js           # CRUD for documents
│   │   └── snapshots.js           # Version history CRUD + restore
│   ├── models/
│   │   ├── User.js                # Mongoose schema (username, bcrypt hash)
│   │   ├── Document.js            # Mongoose schema (title, owner, binary Yjs state)
│   │   └── Snapshot.js            # Mongoose schema (docId, binary state, label)
│   ├── middleware/
│   │   └── authMiddleware.js      # JWT verification middleware
│   ├── yjs-server.js              # WebSocket handler, CRDT engine, Redis pub/sub
│   ├── db.js                      # Mongoose connection
│   ├── .env                       # Environment variables (not committed)
│   └── .env.example               # Environment variable template
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   └── EditorPage.jsx     # Yjs provider + TipTap + awareness
│   │   ├── components/
│   │   │   ├── EditorToolbar.jsx
│   │   │   └── VersionHistory.jsx
│   │   ├── context/
│   │   │   └── AuthContext.jsx    # Auth state + authFetch wrapper
│   │   ├── App.jsx                # Routing + PrivateRoute/PublicRoute guards
│   │   ├── main.jsx
│   │   └── index.css              # ProseMirror + collaboration cursor styles
│   └── package.json
├── notes/                         # Personal notes — not committed
├── .gitignore
└── package.json                   # Root — concurrently runs both services
```

---

## API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Register new user, returns JWT |
| POST | `/auth/login` | None | Login, returns JWT |

### Documents

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/documents` | Owner | List all documents owned by authenticated user |
| POST | `/documents` | Required | Create a new document |
| GET | `/documents/:id` | Required | Get document metadata (any authenticated user) |
| PATCH | `/documents/:id` | Owner | Rename document |
| DELETE | `/documents/:id` | Owner | Delete document |

### Snapshots

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/documents/:id/snapshots` | Required | List all snapshots for a document |
| POST | `/documents/:id/snapshots` | Owner | Create a manual snapshot |
| POST | `/documents/:id/snapshots/:snapId/restore` | Owner | Restore document to a snapshot |

**Access control:** `GET /documents/:id` intentionally allows any authenticated user to read — this enables shareable links. All write operations (`PATCH`, `DELETE`, snapshot creation/restore) are owner-restricted via `findOne({ _id, owner: req.user.id })`.

---

## WebSocket Protocol

The Yjs WebSocket protocol operates on a single connection per document. Message types are encoded as variable-length integers using `lib0`.

### Message Types

| Type | Value | Direction | Description |
|---|---|---|---|
| `MSG_SYNC` | `0` | Bidirectional | Document synchronization (step1, step2, update) |
| `MSG_AWARENESS` | `1` | Bidirectional | Cursor positions, user presence |

### Sync Handshake

```
Client connects
    |
    v
Server sends SYNC_STEP_1 (server's state vector)
    |
    v
Client receives state vector, computes missing updates
Client sends SYNC_STEP_2 (missing updates for server)
Client sends its own SYNC_STEP_1
    |
    v
Server applies missing updates, sends SYNC_STEP_2 to client
    |
    v
Both sides are now in sync
    |
    v
Subsequent edits transmitted as MSG_SYNC updates
```

### Awareness Protocol

Awareness messages carry ephemeral state (cursor position, user name, user color). They are forwarded raw to all other connected peers without being applied to the persistent Yjs document. Awareness state is removed when a client disconnects.

---

## Performance Considerations

### Binary Encoding

Yjs updates are encoded as compact binary using `lib0`'s variable-length integer encoding. This is significantly more efficient than JSON serialization:
- A single character insertion is typically 10–20 bytes over the wire.
- JSON representation of the same operation with metadata would be 5–10x larger.
- Binary parsing is faster than JSON parsing at both the encoding and decoding ends.

### Efficient Synchronization

The sync step-1/step-2 handshake ensures that on reconnection, only the **delta** (missing updates) is transmitted, not the full document state. The state vector encodes the logical clock of each client's contributions, allowing the counterpart to compute exactly which updates are missing.

### Memory Management

Documents are loaded into memory on first connection and unloaded when the last client disconnects. This means idle documents consume no server memory. Active documents are held as Yjs `Doc` instances with their full CRDT state tree.

### Persistence Strategy

- **Write frequency:** Periodic save every 5 seconds prevents data loss without excessive write load.
- **Final flush:** A synchronous save on last disconnect ensures no data is lost between the last periodic save and the document being unloaded.
- **Binary storage:** Document state is stored as a raw `Buffer` (Yjs binary encoding) in MongoDB, not as plain text. This preserves the full CRDT history and enables efficient merge on reload.

### Stateless Authentication

JWT tokens carry all identity information. No database lookup is required to authenticate a request — only a cryptographic verification of the token signature. This keeps REST request latency low and eliminates a database round-trip per authenticated request.

---

## Challenges Faced

### 1. Editor Initialization Race Condition
The TipTap `CollaborationCursor` extension accesses the Yjs awareness object during editor construction. If the WebSocket provider has not yet connected, the awareness state is undefined, causing a crash (`Cannot read properties of undefined (reading 'doc')`).

**Solution:** The TipTap editor is extracted into a `<CollaborativeEditor>` sub-component that renders only after the `connected` state becomes `true`. This defers editor construction until the WebSocket handshake is complete.

### 2. Real-time Sync Failure Without Redis
The initial `ydoc.on('update')` handler returned early when Redis was unavailable (`if (!redisReady) return`). This meant User B's edits were never forwarded to User A on the same server instance.

**Solution:** In-memory broadcast to local WebSocket peers is performed unconditionally. Redis publish is only attempted if `redisReady` is true. The two concerns are now independent.

### 3. Data Loss on Disconnect
The `close` handler cleared the periodic save timer without performing a final save. Edits made in the last 0–5 seconds before the last user disconnected were not persisted.

**Solution:** An async IIFE within the synchronous `close` handler performs a final `findByIdAndUpdate` before unloading the document from memory.

### 4. Dependency Version Fragmentation
Tiptap v3 core packages were installed alongside `@tiptap/extension-collaboration-cursor` which had not yet been released at v3. This resulted in two separate copies of `y-prosemirror` being resolved in `node_modules`, causing a ProseMirror plugin key conflict.

**Solution:** All Tiptap packages pinned to a unified v2.x release where all extensions share a single `y-prosemirror` instance.

### 5. MongoDB URI Special Character Encoding
The MongoDB Atlas connection string password contained parentheses, which are not valid unescaped URI characters. This caused connection failures in environments with strict URI parsing.

**Solution:** URL-encoded the special characters (`(` → `%28`, `)` → `%29`) in the connection string.

---

## Future Improvements

### Short-term
- **WebSocket authentication.** Validate JWT during the HTTP upgrade handshake before accepting the WebSocket connection.
- **Rate limiting.** Apply `express-rate-limit` to auth endpoints to prevent brute-force attacks.
- **Input validation.** Add `zod` or `joi` schema validation on REST request bodies.

### Medium-term
- **Dockerization.** Add `docker-compose.yml` to spin up Node.js, MongoDB, and Redis in a single command for reproducible development environments.
- **Offline support.** Persist Yjs state to `IndexedDB` on the client so edits made offline are queued and merged on reconnect.
- **Document permissions model.** Replace binary owner/non-owner with a role-based system (viewer, commenter, editor).
- **Operational metrics.** Instrument the WebSocket server with Prometheus counters for active connections, update frequency, and save latency.

### Long-term
- **Yjs garbage collection.** Implement CRDT state compaction to prevent unbounded growth of tombstoned deletions in long-lived documents.
- **Export to PDF/DOCX.** Server-side rendering of Yjs state to standard document formats.
- **Change history diffing.** Reconstruct a human-readable diff between any two snapshots using CRDT state vectors.

---

## Learning Outcomes

- Distributed consistency models: strong consistency vs. eventual consistency vs. strong eventual consistency (CRDTs)
- WebSocket protocol mechanics: upgrade handshake, binary framing, connection lifecycle
- Yjs internals: YATA algorithm, state vectors, update encoding, awareness protocol
- Redis Pub/Sub patterns for cross-process event fanout
- JWT stateless authentication and its security implications
- MongoDB binary data storage and the trade-offs of storing CRDT state vs. plain text
- Express middleware patterns for authentication and error handling
- React component lifecycle interaction with WebSocket provider state
- Diagnosing and resolving npm dependency resolution conflicts

---

## Local Development

### Prerequisites
- Node.js >= 18
- MongoDB Atlas account (or local MongoDB)
- Redis (WSL on Windows, or Docker)

### Setup

```bash
# Clone the repository
git clone https://github.com/<your-username>/collab-docs.git
cd collab-docs/editor

# Install all dependencies (root, backend, frontend)
npm install
npm install --prefix backend
npm install --prefix frontend

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your MongoDB URI, JWT secret, and Redis config

# Start Redis (WSL)
sudo service redis-server start

# Start both backend and frontend
npm run dev
```

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net/` |
| `PORT` | HTTP server port | `5000` |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) | `your-long-random-secret` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:5173` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |

Access the application at `http://localhost:5173`.
