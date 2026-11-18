import { defineConfig } from "astro/config";

// Static site: English at /, Turkish at /tr/. Nothing is loaded from other hosts.
export default defineConfig({
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "auto" },
  devToolbar: { enabled: false },
});
