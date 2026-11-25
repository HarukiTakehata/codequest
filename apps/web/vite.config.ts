import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // wasi-sh 常驻会话（Container Shell）需要 SharedArrayBuffer → 跨源隔离。
  // 生产由 public/_headers 提供，本地 vite dev/preview 在此提供同一组头。
  server: {
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  worker: { format: "es" },
});
