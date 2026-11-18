import { describe, it, expect, beforeEach } from "vitest";
import { ContextStore } from "../src/store.js";

const P = "11111111-2222-4333-8444-555555555555";

describe("autonomous mode in the store", () => {
  let store: ContextStore;
  beforeEach(() => {
    store = new ContextStore(":memory:");
  });
  const autoShare = (title: string, extra: Record<string, unknown> = {}) => {
    const e = store.propose({ project: P, kind: "decision", title, body: `${title} body`, sourceAgent: "codex", ...extra });
    return store.approve(e.id, "autonomous", undefined, { auto: true, review: true });
  };

  it("autonomous flag per project", () => {
    expect(store.isAutonomous(P)).toBe(false);
    store.setAutonomous(P, true, "human");
    expect(store.isAutonomous(P)).toBe(true);
    expect(store.isAutonomous("other")).toBe(false);
    store.setAutonomous(P, false, "human");
    expect(store.isAutonomous(P)).toBe(false);
  });

  it("auto-shared records wait in the review list; keep marks reviewed", () => {
    const a = autoShare("A");
    const b = autoShare("B");
    expect(store.unreviewed(P).map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(store.get(a.id)?.reviewState).toBe("unreviewed");
    expect(store.keep([a.id], "human")).toBe(1);
    expect(store.get(a.id)?.reviewState).toBe("kept");
    expect(store.unreviewed(P).map((e) => e.id)).toEqual([b.id]);
  });

  it("undo new record → rejected", () => {
    const a = autoShare("A");
    const r = store.undoAuto(a.id, "human");
    expect(r.undone.status).toBe("rejected");
    expect(r.undone.decisionNote).toMatch(/undone after automatic sharing/);
    expect(store.visible(P, "cursor")).toEqual([]);
    expect(store.unreviewed(P)).toEqual([]);
    expect(store.findRejectedSimilar(P, { title: "A", body: "A body" }).map((e) => e.id)).toEqual([a.id]);
  });

  it("undo replacement restores original", () => {
    const orig = store.addApproved({ project: P, kind: "decision", title: "Use Postgres", body: "Postgres 16" }, "human");
    const b = autoShare("Use MySQL", { supersedes: orig.id });
    expect(store.get(orig.id)?.status).toBe("superseded");
    const r = store.undoAuto(b.id, "human");
    expect(r.restored?.id).toBe(orig.id);
    expect(store.get(orig.id)).toMatchObject({ status: "approved", supersededBy: null });
    expect(store.visible(P, "cursor").map((e) => e.id)).toEqual([orig.id]);
  });

  it("undo leaves a changed original alone", () => {
    const orig = store.addApproved({ project: P, kind: "decision", title: "Use Postgres", body: "Postgres 16" }, "human");
    const b = autoShare("Use MySQL", { supersedes: orig.id });
    // The owner changed the original since (here: retired... it is superseded, so edit its pointer via another replacement path).
    (store as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } }).db
      .prepare("UPDATE entries SET superseded_by = 'cother' WHERE id = ?")
      .run(orig.id);
    const r = store.undoAuto(b.id, "human");
    expect(r.restored).toBeUndefined();
    expect(r.note).toMatch(/not restored/);
    expect(store.get(b.id)?.status).toBe("rejected");
  });

  it("undo refused when already replaced", () => {
    const b = autoShare("B v1");
    autoShare("B v2", { supersedes: b.id });
    expect(() => store.undoAuto(b.id, "human")).toThrow(/undo c\w+ first/);
  });

  it("undo refused for records that were not shared automatically", () => {
    const h = store.addApproved({ project: P, kind: "fact", title: "t", body: "b" }, "human");
    expect(() => store.undoAuto(h.id, "human")).toThrow(/not shared automatically/);
  });
});
