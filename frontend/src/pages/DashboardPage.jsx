import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardPage() {
  const { user, logout, authFetch } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { fetchDocs(); }, []);

  const fetchDocs = async () => {
    try {
      const res  = await authFetch("/documents");
      const data = await res.json();
      if (res.ok) setDocs(data);
    } finally { setLoading(false); }
  };

  const createDoc = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res  = await authFetch("/documents", {
        method: "POST",
        body: JSON.stringify({ title: newTitle.trim() || "Untitled Document" }),
      });
      const data = await res.json();
      if (res.ok) { setShowModal(false); setNewTitle(""); navigate(`/doc/${data.id}`); }
      else { alert("Error: " + data.error); }
    } catch (err) {
      alert("Network Error: " + err.message);
    } finally { setCreating(false); }
  };

  const deleteDoc = async (e, docId) => {
    e.stopPropagation();
    if (!confirm("Delete this document?")) return;
    await authFetch(`/documents/${docId}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== docId));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📝</span>
            <span className="text-lg font-bold text-gray-900">CollabDocs</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">
              Signed in as <span className="font-medium text-gray-800">{user?.username}</span>
            </span>
            <button
              id="logout-btn"
              onClick={() => { logout(); navigate("/login"); }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 hover:border-gray-400 rounded-lg transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Documents</h1>
            <p className="text-gray-500 text-sm mt-1">{docs.length} document{docs.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            id="new-doc-btn"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition text-sm"
          >
            <span>+</span> New Document
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl border border-gray-200">
            <div className="text-5xl mb-4">📄</div>
            <p className="text-gray-700 text-lg font-medium">No documents yet</p>
            <p className="text-gray-400 mt-1 text-sm">Create your first document to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {docs.map((doc) => (
              <div
                key={doc.id}
                id={`doc-card-${doc.id}`}
                onClick={() => navigate(`/doc/${doc.id}`)}
                className="group relative bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-2xl p-6 cursor-pointer transition-all duration-150 hover:shadow-sm"
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-2xl">📄</span>
                  <button
                    id={`delete-doc-${doc.id}`}
                    onClick={(e) => deleteDoc(e, doc.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition text-sm"
                  >
                    🗑
                  </button>
                </div>
                <h3 className="text-gray-900 font-semibold text-base truncate mb-1">{doc.title}</h3>
                <p className="text-gray-400 text-xs">Edited {timeAgo(doc.updatedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* New Document Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold text-gray-900 mb-5">New Document</h2>
            <input
              id="new-doc-title"
              type="text"
              placeholder="Document title (optional)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createDoc()}
              className="w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5 transition"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                id="create-doc-confirm"
                onClick={createDoc}
                disabled={creating}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-xl transition text-sm"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => { setShowModal(false); setNewTitle(""); }}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
