import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: "../dist-ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:8080",
      "/logs": "http://127.0.0.1:8080",
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/health": "http://127.0.0.1:8080",
      "/logs": "http://127.0.0.1:8080",
    },
  },
});
