import { useEffect, useState, useCallback } from "react";
import { Clock, X, RotateCcw, Camera } from "lucide-react";
import { useAuth } from "../context/AuthContext";

function fmtDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function VersionHistory({ docId, onClose }) {
  const { authFetch }             = useAuth();
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [msg, setMsg]             = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch(`/documents/${docId}/snapshots`);
      const data = await res.json();
      if (res.ok) setSnapshots(data);
    } finally { setLoading(false); }
  }, [docId, authFetch]);

  useEffect(() => { load(); }, [load]);

  const takeSnapshot = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await authFetch(`/documents/${docId}/snapshots`, {
        method: "POST",
        body: JSON.stringify({ label: "Manual save" }),
      });
      if (res.ok) { setMsg("✅ Snapshot saved!"); load(); }
      else { const d = await res.json(); setMsg(`❌ ${d.error}`); }
    } finally { setSaving(false); }
  };

  const restore = async (snapId) => {
    if (!confirm("Restore this version? The page will reload.")) return;
    setRestoring(snapId);
    try {
      const res = await authFetch(`/documents/${docId}/snapshots/${snapId}/restore`, { method: "POST" });
      if (res.ok) {
        setMsg("✅ Restored! Reloading…");
        setTimeout(() => window.location.reload(), 1200);
      } else {
        const d = await res.json();
        setMsg(`❌ ${d.error}`);
      }
    } finally { setRestoring(null); }
  };

  return (
    <div className="w-80 flex flex-col h-full border-l border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2 text-gray-800 font-semibold text-sm">
          <Clock size={15} className="text-gray-500" />
          Version History
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={takeSnapshot}
            disabled={saving}
            title="Save snapshot now"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded-lg transition disabled:opacity-50"
          >
            <Camera size={12} />
            {saving ? "Saving…" : "Save Now"}
          </button>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Status message */}
      {msg && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-gray-50 text-xs text-gray-600 border border-gray-200">
          {msg}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-12">
            <Clock size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No snapshots yet</p>
            <p className="text-gray-400 text-xs mt-1">Auto-saves every 5 minutes</p>
          </div>
        ) : (
          snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center justify-between gap-2 p-3 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl group transition"
            >
              <div className="min-w-0">
                <p className="text-gray-800 text-sm font-medium truncate">{snap.label}</p>
                <p className="text-gray-400 text-xs mt-0.5">{fmtDate(snap.createdAt)}</p>
              </div>
              <button
                onClick={() => restore(snap.id)}
                disabled={restoring === snap.id}
                title="Restore this version"
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-blue-50 text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-200 rounded-lg transition opacity-0 group-hover:opacity-100 disabled:opacity-50"
              >
                <RotateCcw size={11} />
                {restoring === snap.id ? "…" : "Restore"}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-200 text-xs text-gray-400 text-center">
        Max 20 snapshots · Oldest auto-deleted
      </div>
    </div>
  );
}
