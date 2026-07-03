import express from "express";
import Document from "../models/Document.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// All document routes require a valid JWT
router.use(protect);

// POST /documents — create a new document
router.post("/", async (req, res) => {
  try {
    const doc = await Document.create({
      title: req.body.title || "Untitled Document",
      owner: req.user.id,
    });
    res.status(201).json({ id: doc._id, title: doc.title, createdAt: doc.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents — list all documents owned by the authenticated user
router.get("/", async (req, res) => {
  try {
    const docs = await Document.find({ owner: req.user.id })
      .select("title createdAt updatedAt")
      .sort({ updatedAt: -1 });
    res.json(docs.map((d) => ({ id: d._id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /documents/:id — get a single document's metadata
// Any authenticated user can read a doc by ID (needed for shareable links).
// Only PATCH/DELETE remain owner-restricted.
router.get("/:id", async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id).select("title createdAt updatedAt owner");
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json({ id: doc._id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt, isOwner: String(doc.owner) === String(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /documents/:id — rename a document
router.patch("/:id", async (req, res) => {
  try {
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, owner: req.user.id },
      { title: req.body.title },
      { new: true }
    ).select("title updatedAt");
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json({ id: doc._id, title: doc.title, updatedAt: doc.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /documents/:id
router.delete("/:id", async (req, res) => {
  try {
    const doc = await Document.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json({ message: "Document deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
