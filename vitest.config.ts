import { defineConfig } from "vitest/config";

const perf = process.env.BAGLAM_PERF === "1";

export default defineConfig({
  // JSX in ui/ and test/*.tsx compiles against Preact.
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  test: {
    // Builds src/ into .test-dist/ once; tests never touch dist/ (the live install).
    globalSetup: ["test/global-setup.ts"],
    // The speed test needs a quiet machine, so it runs on its own: npm run test:perf.
    include: perf ? ["test/perf.test.ts"] : ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: perf ? [] : ["test/perf.test.ts", "**/node_modules/**"],
  },
});
