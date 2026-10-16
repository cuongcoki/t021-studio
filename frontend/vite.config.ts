import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: the Python backend (backend/server.py) serves /api; `npm run build` output is served by it too.
const BACKEND = process.env.T021_BACKEND ?? "http://127.0.0.1:8781";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { port: 5181, strictPort: true, proxy: { "/api": { target: BACKEND, changeOrigin: false } } },
});
