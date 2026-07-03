import "dotenv/config"; // loads .env into process.env automatically
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("❌ MONGODB_URI is not defined in .env file");
}

// link format -> mongodb+srv://<user>:<pass>@<cluster>/<db>
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ DB connected"))
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1); // crash fast — don't run without a DB
  });

export default mongoose;

/*
Your App
   ↓
mongoose.connect(process.env.MONGODB_URI)  ← from .env
   ↓
MongoDB Atlas (cloud)
   ↓
Database: editor
   ↓
Collection: documents
 */