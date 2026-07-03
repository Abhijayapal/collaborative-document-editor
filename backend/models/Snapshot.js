import mongoose from "mongoose";

const snapshotSchema = new mongoose.Schema(
  {
    // Reference to the parent document
    docId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    // Binary Yjs CRDT state at this point in time
    data:  { type: Buffer, required: true },
    // Optional human-readable label (e.g. "Auto-save" or user-provided name)
    label: { type: String, default: "Auto-save" },
  },
  { timestamps: true }
);

export default mongoose.model("Snapshot", snapshotSchema);
