import { describe, it, expect, beforeEach } from "vitest";
import { ContextStore } from "../src/store.js";
import { SCHEMA_VERSION } from "../src/migrate.js";

const P = "11111111-2222-4333-8444-555555555555";
const DAY = 86_400_000;
const AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

describe("handoffs in the store", () => {
  let store: ContextStore;
  let now: number;
  beforeEach(() => {
    now = 1_700_000_000_000;
    store = new ContextStore(":memory:", () => now);
  });
  const cp = (over: Record<string, unknown> = {}) =>
    store.checkpoint({ project: P, branch: "main", dir: "c:/app", agent: "claude-code", ...over });

  it("schema 6", () => expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6));

  it("first checkpoint needs a goal", () => {
    expect(() => cp({ now: "x" })).toThrow(/goal/);
    const h = cp({ goal: "Stripe checkout", now: "form", next: ["webhook", "tests"] });
    expect(h).toMatchObject({ goal: "Stripe checkout", status: "in_progress", now: "form", next: ["webhook", "tests"], agent: "claude-code" });
    expect(h.taskId).toMatch(/^t/);
  });

  it("rewording the goal keeps the task", () => {
    const a = cp({ goal: "Stripe checkout", done: ["validation"], next: ["webhook"] });
    now += 60_000;
    const b = store.checkpoint({ project: P, branch: "main", agent: "codex", goal: "Stripe checkout flow" });
    expect(b.taskId).toBe(a.taskId);
    expect(b).toMatchObject({ goal: "Stripe checkout flow", done: ["validation"], next: ["webhook"], agent: "codex", dir: "c:/app" });
  });

  it("new_task archives the old task", () => {
    const a = cp({ goal: "A", done: ["x"] });
    now += 1000;
    const b = cp({ goal: "B", newTask: true });
    expect(b.taskId).not.toBe(a.taskId);
    expect(b.done).toEqual([]);
    const hist = store.handoffHistory(P, "main");
    expect(hist.some((h) => h.taskId === a.taskId && h.replaced)).toBe(true);
  });

  it("a done task is replaced by the next goal without new_task", () => {
    const a = cp({ goal: "A" });
    cp({ status: "done" });
    const b = cp({ goal: "B" });
    expect(b.taskId).not.toBe(a.taskId);
  });

  it("done_add appends; omitted fields keep values", () => {
    cp({ goal: "G", done: ["one"], now: "two", files: ["a.ts"] });
    const h = cp({ doneAdd: ["two"], now: "three" });
    expect(h).toMatchObject({ done: ["one", "two"], now: "three", files: ["a.ts"] });
  });

  it("checkpoint refuses secrets", () => {
    expect(() => cp({ goal: "G", notes: `key ${AWS}` })).toThrow(/secret/);
    expect(store.getHandoff(P, "main")).toBeUndefined();
  });

  it("checkpoint caps field sizes", () => {
    const h = cp({ goal: "g".repeat(10_000), done: Array.from({ length: 100 }, (_, i) => `step ${i}`), notes: "n".repeat(10_000_000) });
    expect(h.goal.length).toBeLessThanOrEqual(300);
    expect(h.done.length).toBe(30);
    expect(h.notes!.length).toBeLessThanOrEqual(2000);
  });

  it("rejects an unknown status", () => {
    expect(() => cp({ goal: "G", status: "paused" })).toThrow(/status/);
  });

  it("expired handoff is gone", () => {
    cp({ goal: "G" });
    now += 7 * DAY + 1;
    expect(store.getHandoff(P, "main")).toBeUndefined();
    expect(store.listHandoffs(P)).toEqual([]);
  });

  it("history coalesces same agent within 60 s", () => {
    cp({ goal: "G" });
    now += 10_000;
    cp({ now: "a" });
    now += 10_000;
    cp({ now: "b" });
    expect(store.handoffHistory(P, "main")).toHaveLength(1);
    now += 61_000;
    cp({ now: "c" });
    expect(store.handoffHistory(P, "main")).toHaveLength(2);
    store.checkpoint({ project: P, branch: "main", agent: "codex", now: "d" });
    expect(store.handoffHistory(P, "main")).toHaveLength(3);
  });

  it("history keeps 50", () => {
    for (let i = 0; i < 60; i++) {
      now += 61_000;
      cp({ goal: "G", now: `${i}` });
    }
    expect(store.handoffHistory(P, "main", 100)).toHaveLength(50);
  });

  it("branches are separate", () => {
    cp({ goal: "Main work" });
    store.checkpoint({ project: P, branch: "feature", agent: "codex", goal: "Feature work" });
    expect(store.getHandoff(P, "main")?.goal).toBe("Main work");
    expect(store.getHandoff(P, "feature")?.goal).toBe("Feature work");
    expect(store.listHandoffs(P).map((h) => h.branch).sort()).toEqual(["feature", "main"]);
  });

  it("clearHandoff marks done", () => {
    cp({ goal: "G" });
    expect(store.clearHandoff(P, "main", "human")).toBe(true);
    expect(store.getHandoff(P, "main")?.status).toBe("done");
    expect(store.clearHandoff(P, "other", "human")).toBe(false);
  });

  it("rekey moves handoffs and settings", () => {
    const old = "c:/work/app";
    store.checkpoint({ project: old, branch: "main", agent: "a", goal: "G" });
    store.setAutonomous(old, true, "human");
    store.rekeyProject(old, P);
    expect(store.getHandoff(P, "main")?.goal).toBe("G");
    expect(store.isAutonomous(P)).toBe(true);
    expect(store.handoffHistory(P, "main")).toHaveLength(1);
  });
});
