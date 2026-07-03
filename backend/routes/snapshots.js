import express from "express";
import Snapshot from "../models/Snapshot.js";
import Document from "../models/Document.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router({ mergeParams: true }); // gets :id from parent router
router.use(protect);

const MAX_SNAPSHOTS = 20;

// ── GET /documents/:id/snapshots — list all snapshots (newest first)
router.get("/", async (req, res) => {
  try {
    const snapshots = await Snapshot.find({ docId: req.params.id })
      .select("label createdAt")
      .sort({ createdAt: -1 });
    res.json(snapshots.map((s) => ({ id: s._id, label: s.label, createdAt: s.createdAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /documents/:id/snapshots — manually create a snapshot
router.post("/", async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, owner: req.user.id });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (!doc.data) return res.status(400).json({ error: "Document has no content yet" });

    await pruneOldSnapshots(req.params.id);

    const snap = await Snapshot.create({
      docId: req.params.id,
      data:  doc.data,
      label: req.body.label || `Manual save`,
    });
    res.status(201).json({ id: snap._id, label: snap.label, createdAt: snap.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /documents/:id/snapshots/:snapId/restore — restore a snapshot
router.post("/:snapId/restore", async (req, res) => {
  try {
    const snap = await Snapshot.findById(req.params.snapId);
    if (!snap) return res.status(404).json({ error: "Snapshot not found" });

    // Verify document ownership
    const doc = await Document.findOne({ _id: req.params.id, owner: req.user.id });
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Overwrite document data with snapshot binary state
    await Document.findByIdAndUpdate(req.params.id, { data: snap.data });

    res.json({ message: "Restored. Reload the editor to see the restored version." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: delete oldest snapshot if over the limit
export async function pruneOldSnapshots(docId) {
  const count = await Snapshot.countDocuments({ docId });
  if (count >= MAX_SNAPSHOTS) {
    const oldest = await Snapshot.findOne({ docId }).sort({ createdAt: 1 });
    if (oldest) await oldest.deleteOne();
  }
}

export default router;
