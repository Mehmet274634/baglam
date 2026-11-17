import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The installed package's version (read from package.json, so it can never drift). */
export const VERSION: string = (() => {
  try {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();
