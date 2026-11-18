import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextStore, KINDS } from "../src/store.js";
import { formatBrief } from "../src/format.js";

const P = "11111111-2222-4333-8444-555555555555";
// 50 ms is the product budget, measured on an idle machine (`npm run test:perf`).
// Shared CI runners are noisier, so CI passes a looser BAGLAM_PERF_BUDGET_MS.
const BUDGET_MS = Number(process.env.BAGLAM_PERF_BUDGET_MS) || 50;
// A realistic vocabulary (~3,000 words) so records overlap the way real notes do; with only a
// handful of words every record would match every query, which no real project looks like.
const SYLLABLES = "ba ce di fo gu ka le mi no pu ra se ti vo zu da ne ri so tu ma pe li ko ru".split(" ");
const WORDS = Array.from({ length: 3000 }, (_, i) => {
  let w = "", n = i + 7;
  for (let k = 0; k < 3; k++) { w += SYLLABLES[n % SYLLABLES.length]; n = Math.floor(n / SYLLABLES.length) + k * 13; }
  return w;
}).concat("database cache queue worker deploy staging lint format test build release api schema index migration token".split(" "));

function median(fn: () => void, runs = 20): number {
  for (let i = 0; i < 3; i++) fn(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)];
}

describe("speed with 10,000 records", () => {
  let store: ContextStore;

  beforeAll(() => {
    store = new ContextStore(join(mkdtempSync(join(tmpdir(), "baglam-perf-")), "perf.db"));
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];
    for (let i = 0; i < 10_000; i++) {
      const project = i % 10 === 0 ? P : `${P.slice(0, -1)}${i % 9}`;
      store.addApproved(
        {
          project,
          kind: KINDS[i % KINDS.length],
          title: `${pick()} ${pick()} rule ${i}`,
          body: `Always ${pick()} the ${pick()} before ${pick()}; see ${pick()} ${pick()} notes ${i}.`,
          tags: [pick()],
        },
        "human",
      );
    }
    for (let i = 0; i < 9_000; i++) {
      store.addApproved({ project: P, kind: KINDS[i % KINDS.length], title: `${pick()} ${pick()} item ${i}`, body: `${pick()} ${pick()} ${pick()} ${i}` }, "human");
    }
  }, 240_000);
  afterAll(() => store.close());

  it(`brief stays under ${BUDGET_MS} ms`, () => {
    const ms = median(() =>
      // Exactly what context_brief does.
      formatBrief({
        project: { key: P, name: "app", dir: "c:/app", initialized: true, anchor: "marker" },
        agent: "cursor",
        entries: store.visible(P, "cursor", { limit: 150, byPriority: true }),
        total: store.countVisible(P, "cursor", 1000),
        totalCapped: true,
        pendingCount: store.pending(P).length,
      }),
    );
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it(`search stays under ${BUDGET_MS} ms`, () => {
    expect(median(() => store.search(P, "cursor", "database migration"))).toBeLessThan(BUDGET_MS);
  });

  it(`duplicate check stays under ${BUDGET_MS} ms`, () => {
    expect(median(() => store.findSimilar(P, { title: "database cache rule", body: "Always deploy the staging before release" }))).toBeLessThan(BUDGET_MS);
  });

  it(`flood check and project list stay under ${BUDGET_MS} ms`, () => {
    expect(median(() => store.countPending(P, "codex"))).toBeLessThan(BUDGET_MS);
    expect(median(() => store.listProjects(), 5)).toBeLessThan(BUDGET_MS * 4);
  });
});

describe("speed with work in progress", () => {
  it(`brief with a live handoff stays under ${BUDGET_MS} ms; git snapshot under ${BUDGET_MS * 3} ms`, async () => {
    const { execFileSync, spawnSync } = await import("node:child_process");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { gitSnapshot } = await import("../src/git.js");
    const store = new ContextStore(join(mkdtempSync(join(tmpdir(), "baglam-perf-h-")), "p.db"));
    for (let i = 0; i < 2000; i++) store.addApproved({ project: P, kind: KINDS[i % 5], title: `rule ${i}`, body: `body ${i}` }, "h");
    const h = store.checkpoint({
      project: P, branch: "main", agent: "claude-code", goal: "Checkout", done: Array.from({ length: 30 }, (_, i) => `step ${i}`),
      next: Array.from({ length: 20 }, (_, i) => `next ${i}`), files: Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`),
    });
    const briefMs = median(() =>
      formatBrief({
        project: { key: P, name: "app", dir: "c:/app", initialized: true, anchor: "marker" },
        agent: "codex",
        entries: store.visible(P, "codex", { limit: 150, byPriority: true }),
        total: store.countVisible(P, "codex", 1000),
        pendingCount: 0,
        handoff: { live: h, git: null, otherBranches: [] },
      }),
    );
    expect(briefMs).toBeLessThan(BUDGET_MS);

    if (spawnSync("git", ["--version"]).status !== 0) return;
    const repo = mkdtempSync(join(tmpdir(), "baglam-perf-git-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    mkdirSync(join(repo, "src"));
    for (let i = 0; i < 300; i++) writeFileSync(join(repo, "src", `f${i}.ts`), `export const v = ${i};`);
    git("add", ".");
    git("commit", "-q", "-m", "init");
    for (let i = 0; i < 5; i++) writeFileSync(join(repo, "src", `f${i}.ts`), "changed");
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      await gitSnapshot(repo, Date.now() - 60_000);
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    expect(times[3]).toBeLessThan(BUDGET_MS * 3);
  }, 120_000);
});
