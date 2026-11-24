import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_ADMIN_BASE || "/",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: process.env.VITE_ADMIN_BASE === "/admin/" ? "../../apps/web/dist/admin" : "dist",
    emptyOutDir: process.env.VITE_ADMIN_BASE !== "/admin/",
  },
});
