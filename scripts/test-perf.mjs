#!/usr/bin/env node
// Runs only the 10k-record speed test, alone, so other tests don't skew the timings.
// Pass a looser budget on noisy machines: BAGLAM_PERF_BUDGET_MS=150 npm run test:perf
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const r = spawnSync(process.execPath, [vitest, "run"], { stdio: "inherit", env: { ...process.env, BAGLAM_PERF: "1" } });
process.exit(r.status ?? 1);
