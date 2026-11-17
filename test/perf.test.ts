import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextStore, KINDS } from "../src/store.js";
import { formatBrief } from "../src/format.js";

const P = "11111111-2222-4333-8444-555555555555";
const BUDGET_MS = 50;
const WORDS = "database cache queue worker deploy staging lint format test build release api schema index migration token session theme layout router".split(" ");

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
      formatBrief({
        project: { key: P, name: "app", dir: "c:/app", initialized: true, anchor: "marker" },
        agent: "cursor",
        entries: store.visible(P, "cursor", { limit: 1000 }),
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
