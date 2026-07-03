import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import UnderlineExt from "@tiptap/extension-underline";
import { useAuth } from "../context/AuthContext";
import EditorToolbar from "../components/EditorToolbar";
import VersionHistory from "../components/VersionHistory";

const COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#f97316"];
const randColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// We extract the actual TipTap editor into a sub-component so it is ONLY
// mounted after the WebSocket provider has successfully connected.
// This completely avoids the y-prosemirror initialization race condition crash!
function CollaborativeEditor({ ydoc, provider, user, userColor }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      UnderlineExt,
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: user?.username || "Anonymous", color: userColor },
      }),
      Placeholder.configure({
        placeholder: "Start writing… changes sync in real-time.",
      }),
    ],
    editorProps: {
      attributes: { class: "focus:outline-none min-h-full" },
    },
  });

  return (
    <>
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto min-h-full">
          <EditorContent
            id="tiptap-editor"
            editor={editor}
            className="min-h-full text-gray-900 text-[15px] leading-7"
          />
        </div>
      </div>
    </>
  );
}

export default function EditorPage() {
  const { id: docId } = useParams();
  const navigate      = useNavigate();
  const { user, authFetch } = useAuth();

  const [title, setTitle]               = useState("Loading…");
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle]     = useState("");
  const [connected, setConnected]       = useState(false);
  const [users, setUsers]               = useState([]);
  const [showHistory, setShowHistory]   = useState(false);
  const [copied, setCopied]             = useState(false);
  const [savedMsg, setSavedMsg]         = useState("");
  const [isOwner, setIsOwner]           = useState(false);

  const userColorRef = useRef(randColor());

  // Create ydoc + provider once (stable refs, not re-created on re-render)
  const ydocRef     = useRef(null);
  const providerRef = useRef(null);
  if (!ydocRef.current) {
    ydocRef.current     = new Y.Doc();
    const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:5000/yjs";
    
    providerRef.current = new WebsocketProvider(
      wsUrl,
      docId,
      ydocRef.current
    );
  }
  const ydoc     = ydocRef.current;
  const provider = providerRef.current;

  // Set local user info in awareness as soon as provider is created
  useEffect(() => {
    provider.awareness.setLocalStateField("user", {
      name:  user?.username || "Anonymous",
      color: userColorRef.current,
    });

    return () => {
      provider.disconnect();
      ydoc.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track connection status + online users
  useEffect(() => {
    const onStatus = ({ status }) => setConnected(status === "connected");
    const onAwareness = () => {
      const states = Array.from(provider.awareness.getStates().values());
      setUsers(states.map((s) => s.user).filter(Boolean));
    };
    provider.on("status", onStatus);
    provider.awareness.on("change", onAwareness);
    return () => {
      provider.off("status", onStatus);
      provider.awareness.off("change", onAwareness);
    };
  }, [provider]);

  // Load document title
  useEffect(() => {
    authFetch(`/documents/${docId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { navigate("/dashboard"); return; }
        setTitle(d.title);
        setDraftTitle(d.title);
        setIsOwner(d.isOwner === true);
      })
      .catch(() => navigate("/dashboard"));
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Title save ─────────────────────────────────────────────────────
  const saveTitle = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim() || "Untitled Document";
    if (trimmed === title) return;
    setTitle(trimmed);
    await authFetch(`/documents/${docId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: trimmed }),
    });
  }, [draftTitle, title, docId, authFetch]);

  // ── Share / copy link ───────────────────────────────────────────
  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // Show "Saved" flash when ydoc changes (user typed something)
  useEffect(() => {
    let timer;
    const onUpdate = () => {
      setSavedMsg("Saving…");
      clearTimeout(timer);
      timer = setTimeout(() => setSavedMsg("✓ Saved"), 5200); // just after 5s periodic save
    };
    ydoc.on("update", onUpdate);
    return () => { ydoc.off("update", onUpdate); clearTimeout(timer); };
  }, [ydoc]);


  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">

      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-white">
        <button
          id="back-btn"
          onClick={() => navigate("/dashboard")}
          className="text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 px-2 py-1.5 rounded-lg transition"
        >
          ← Back
        </button>

        <div className="w-px h-5 bg-gray-200" />

        {editingTitle && isOwner ? (
          <input
            id="doc-title-input"
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
            className="flex-1 text-gray-900 font-semibold text-base bg-gray-50 border border-blue-400 rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
          />
        ) : (
          <h1
            id="doc-title-display"
            onClick={() => { if (isOwner) { setEditingTitle(true); setDraftTitle(title); } }}
            title={isOwner ? "Click to rename" : "Shared document (read-only title)"}
            className={`flex-1 text-gray-900 font-semibold text-base px-2 py-1 rounded-lg transition truncate ${isOwner ? "hover:bg-gray-100 cursor-text" : "cursor-default"}`}
          >
            {title}
          </h1>
        )}

        {/* Connection status dot */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-yellow-400 animate-pulse"}`} />
          <span className="text-xs text-gray-500 hidden sm:block">{connected ? "Live" : "Connecting…"}</span>
        </div>

        {/* Online user avatars */}
        <div className="flex items-center -space-x-1.5">
          {users.slice(0, 5).map((u, i) => (
            <div
              key={i}
              title={u.name}
              style={{ backgroundColor: u.color }}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-white cursor-default"
            >
              {u.name.charAt(0).toUpperCase()}
            </div>
          ))}
          {users.length > 5 && (
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-semibold ring-2 ring-white">
              +{users.length - 5}
            </div>
          )}
        </div>

        {/* History toggle */}
        <button
          id="history-btn"
          onClick={() => setShowHistory((v) => !v)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition
            ${showHistory
              ? "bg-blue-50 text-blue-700 border-blue-300"
              : "text-gray-600 border-gray-300 hover:border-gray-400 hover:bg-gray-50"}`}
        >
          🕐 History
        </button>

        {/* Share button */}
        <button
          id="share-btn"
          onClick={copyLink}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition
            ${copied
              ? "bg-green-50 text-green-700 border-green-300"
              : "text-gray-600 border-gray-300 hover:border-gray-400 hover:bg-gray-50"}`}
        >
          {copied ? "✓ Copied!" : "🔗 Share"}
        </button>

        {/* Save status */}
        {savedMsg && (
          <span className={`text-xs shrink-0 transition-opacity ${
            savedMsg.startsWith("✓") ? "text-green-600" : "text-gray-400"
          }`}>
            {savedMsg}
          </span>
        )}

      </header>

      {/* Editor + History sidebar */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Render editor ONLY after WebSocket is connected to prevent crash */}
        {connected ? (
          <CollaborativeEditor ydoc={ydoc} provider={provider} user={user} userColor={userColorRef.current} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <span className="animate-pulse">Connecting to collaborative editor…</span>
          </div>
        )}

        {showHistory && (
          <VersionHistory docId={docId} onClose={() => setShowHistory(false)} />
        )}
      </div>

      {/* Footer */}
      <footer className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-400">
        <span>{users.length} active user{users.length !== 1 ? "s" : ""}</span>
        <span>Yjs CRDT · auto-saved every 5s · snapshots every 5min</span>
      </footer>
    </div>
  );
}
