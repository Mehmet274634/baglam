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
