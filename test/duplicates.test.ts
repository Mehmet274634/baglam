import { describe, it, expect, beforeEach } from "vitest";
import { ContextStore } from "../src/store.js";

const P = "11111111-2222-4333-8444-555555555555";

describe("findSimilar", () => {
  let store: ContextStore;
  beforeEach(() => {
    store = new ContextStore(":memory:");
  });

  const add = (title: string, body: string, over: Record<string, unknown> = {}) =>
    store.propose({ project: P, kind: "convention", title, body, sourceAgent: "claude-code", ...over });

  it("finds a near-identical approved record", () => {
    const a = add("Use pnpm as the package manager", "This project uses pnpm. Do not use npm or yarn; the lockfile is pnpm-lock.yaml.");
    store.approve(a.id, "human");
    const hits = store.findSimilar(P, { title: "Package manager is pnpm", body: "This project uses pnpm, not npm or yarn. The lockfile is pnpm-lock.yaml." });
    expect(hits.map((h) => h.id)).toEqual([a.id]);
  });

  it("flags a duplicate of a pending proposal", () => {
    const a = add("Prod database is read-only", "Never run migrations against production from an agent session.");
    const hits = store.findSimilar(P, { title: "Prod database is read-only", body: "Never run migrations against production from an agent." });
    expect(hits.map((h) => h.id)).toEqual([a.id]);
  });

  it("ignores other projects and rejected records", () => {
    add("Use pnpm", "pnpm only for installs and scripts", { project: "other" });
    const r = add("Use pnpm", "pnpm only for installs and scripts");
    store.reject(r.id, "human");
    expect(store.findSimilar(P, { title: "Use pnpm", body: "pnpm only for installs and scripts" })).toEqual([]);
  });

  it("unrelated text is not similar", () => {
    store.approve(add("Use pnpm", "pnpm for installs").id, "human");
    expect(store.findSimilar(P, { title: "Turkish UI copy", body: "All interface text is written in Turkish." })).toEqual([]);
  });

  it("respects kind filter and excludeId", () => {
    const a = add("Use pnpm", "pnpm only for installs and scripts");
    expect(store.findSimilar(P, { title: "Use pnpm", body: "pnpm only for installs and scripts" }, { kind: "decision" })).toEqual([]);
    expect(store.findSimilar(P, { title: "Use pnpm", body: "pnpm only for installs and scripts" }, { excludeId: a.id })).toEqual([]);
  });

  it("stores similarTo on proposals", () => {
    const a = add("Use pnpm", "pnpm only");
    const b = store.propose({ project: P, kind: "convention", title: "Use pnpm", body: "pnpm only", sourceAgent: "codex", similarTo: [a.id] });
    expect(store.get(b.id)?.similarTo).toEqual([a.id]);
    expect(store.get(a.id)?.similarTo).toEqual([]);
  });

  it("tolerates text with no usable words", () => {
    expect(store.findSimilar(P, { title: "!!", body: "?? 12" })).toEqual([]);
  });
});
