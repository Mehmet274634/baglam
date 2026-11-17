import { defineConfig } from "vitest/config";

export default defineConfig({
  // JSX in ui/ and test/*.tsx compiles against Preact.
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
