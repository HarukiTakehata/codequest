import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_EDITOR_BASE || "/",
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
  preview: {
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: process.env.VITE_EDITOR_BASE === "/editor/" ? "../../apps/web/dist/editor" : "dist",
    emptyOutDir: process.env.VITE_EDITOR_BASE !== "/editor/",
  },
});
