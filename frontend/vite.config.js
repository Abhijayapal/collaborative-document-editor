const __dirname = path.resolve();
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "prosemirror-state",
      "prosemirror-model",
      "prosemirror-transform",
      "prosemirror-view",
      "y-prosemirror",
      "@tiptap/core"
    ]
  },
})