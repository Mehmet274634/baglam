import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [preact()],
  build: {
    outDir: fileURLToPath(new URL("../dist/panel", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
  },
});
