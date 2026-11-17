import { describe, it, expect, beforeEach } from "vitest";
import { ContextStore } from "../src/store.js";

const P = "c:/work/app";

describe("ContextStore", () => {
  let store: ContextStore;
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    store = new ContextStore(":memory:", () => now);
  });

  const propose = (over: Partial<Parameters<ContextStore["propose"]>[0]> = {}) =>
    store.propose({
      project: P,
      kind: "decision",
      title: "Use Postgres",
      body: "Primary database is Postgres 16.",
      sourceAgent: "claude-code",
      ...over,
    });

  it("new proposals are pending and invisible to agents", () => {
    const e = propose();
    expect(e.status).toBe("proposed");
    expect(store.visible(P, "cursor")).toHaveLength(0);
    expect(store.pending(P).map((x) => x.id)).toEqual([e.id]);
  });

  it("approved entries are visible to every agent when audience is '*'", () => {
    const e = propose();
    store.approve(e.id, "human");
    expect(store.visible(P, "cursor").map((x) => x.id)).toEqual([e.id]);
    expect(store.visible(P, "codex")).toHaveLength(1);
    expect(store.get(e.id)?.decidedBy).toBe("human");
  });

  it("audience restricts visibility to named agents", () => {
    const e = propose({ audience: ["support-agent"] });
    store.approve(e.id, "human");
    expect(store.visible(P, "support-agent")).toHaveLength(1);
    expect(store.visible(P, "cursor")).toHaveLength(0);
  });

  it("entries are isolated per project", () => {
    store.approve(propose().id, "human");
    expect(store.visible("c:/work/other", "cursor")).toHaveLength(0);
  });

  it("expired entries disappear", () => {
    const e = propose({ ttlDays: 7 });
    store.approve(e.id, "human");
    now += 6 * 86_400_000;
    expect(store.visible(P, "cursor")).toHaveLength(1);
    now += 2 * 86_400_000;
    expect(store.visible(P, "cursor")).toHaveLength(0);
  });

  it("approving a superseding entry retires the old one", () => {
    const old = propose();
    store.approve(old.id, "human");
    const next = propose({ title: "Use MySQL", body: "Switched to MySQL 8.", supersedes: old.id });
    expect(store.visible(P, "cursor").map((x) => x.id)).toEqual([old.id]);
    store.approve(next.id, "human");
    expect(store.visible(P, "cursor").map((x) => x.id)).toEqual([next.id]);
    const retired = store.get(old.id)!;
    expect(retired.status).toBe("superseded");
    expect(retired.supersededBy).toBe(next.id);
  });

  it("rejects supersedes pointing at another project or unknown id", () => {
    expect(() => propose({ supersedes: "nope" })).toThrow(/unknown/i);
    const other = propose({ project: "c:/x" });
    expect(() => propose({ supersedes: other.id })).toThrow(/project/i);
  });

  it("rejected entries never become visible and cannot be approved later", () => {
    const e = propose();
    store.reject(e.id, "human", "wrong");
    expect(store.get(e.id)?.status).toBe("rejected");
    expect(store.get(e.id)?.decisionNote).toBe("wrong");
    expect(() => store.approve(e.id, "human")).toThrow(/not pending/i);
  });

  it("full-text search finds visible entries only", () => {
    const a = propose({ title: "Tabs vs spaces", body: "Use two-space indentation.", kind: "convention" });
    propose({ title: "Secret plan", body: "indentation tricks" }); // pending
    store.approve(a.id, "human");
    const hits = store.search(P, "cursor", "indentation");
    expect(hits.map((h) => h.id)).toEqual([a.id]);
    expect(store.search(P, "cursor", "indentation", { kind: "decision" })).toHaveLength(0);
  });

  it("search tolerates punctuation and FTS operators in user queries", () => {
    store.approve(propose({ body: "Node.js 22 \"LTS\" (required)" }).id, "human");
    expect(() => store.search(P, "cursor", 'node.js "LTS" OR (AND')).not.toThrow();
    expect(store.search(P, "cursor", "node.js")).toHaveLength(1);
  });

  it("addApproved creates an immediately visible human entry", () => {
    const e = store.addApproved({ project: P, kind: "preference", title: "Turkish UI", body: "UI copy is Turkish." }, "human");
    expect(e.status).toBe("approved");
    expect(e.sourceAgent).toBe("human");
    expect(store.visible(P, "cursor")).toHaveLength(1);
  });

  it("validates kind and required text", () => {
    expect(() => propose({ kind: "rumor" as never })).toThrow(/kind/i);
    expect(() => propose({ title: "  " })).toThrow(/title/i);
  });

  it("persists tags and audience as arrays", () => {
    const e = propose({ tags: ["db", "infra"], audience: ["cursor", "codex"] });
    const got = store.get(e.id)!;
    expect(got.tags).toEqual(["db", "infra"]);
    expect(got.audience).toEqual(["cursor", "codex"]);
  });

  it("lists projects with counts", () => {
    store.approve(propose().id, "human");
    propose();
    expect(store.projects()).toEqual([{ project: P, approved: 1, pending: 1 }]);
  });
});
