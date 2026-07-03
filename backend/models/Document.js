import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    title:  { type: String, default: "Untitled Document", trim: true },
    owner:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    data:   { type: Buffer, default: null }, // Binary Yjs CRDT state — NOT plain text
  },
  { timestamps: true }
);

export default mongoose.model("Document", documentSchema);
