import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { host: "127.0.0.1" },
  build: { target: "es2022", assetsInlineLimit: 0, rollupOptions: { input: { main: "index.html", plugin: "plugin.html", ess: "ess.html" } } },
});
