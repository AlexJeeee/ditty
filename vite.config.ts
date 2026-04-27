import { crx } from "@crxjs/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [vue(), crx({ manifest })],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  build: {
    emptyOutDir: true,
    sourcemap: true
  }
});
