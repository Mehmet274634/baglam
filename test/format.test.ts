import { describe, it, expect } from "vitest";
import { formatBrief } from "../src/format.js";
import type { Entry, Kind } from "../src/store.js";
import type { ProjectRef } from "../src/project.js";

const project: ProjectRef = { key: "k", name: "app", dir: "c:/work/app", initialized: true, anchor: "marker" };

let n = 0;
function entry(kind: Kind, title: string, bodyLen = 400): Entry {
  n++;
  return {
    id: `c${n}`, project: "k", kind, title, body: "x".repeat(bodyLen), rationale: null, tags: [], audience: ["*"],
    status: "approved", sourceAgent: "claude-code", createdAt: n, decidedAt: n, decidedBy: "human",
    decisionNote: null, expiresAt: null, supersedes: null, supersededBy: null, editedAt: null, autoApproved: false,
  };
}

describe("formatBrief", () => {
  it("stays within budget and reports the cut", () => {
    const entries = Array.from({ length: 300 }, (_, i) => entry("fact", `Fact ${i}`));
    const out = formatBrief({ project, agent: "cursor", entries, pendingCount: 0 });
    expect(Math.ceil(out.length / 4)).toBeLessThanOrEqual(2000);
    expect(out).toMatch(/\d+ more record\(s\) not shown/);
  });

  it("warnings survive truncation", () => {
    const entries = [...Array.from({ length: 300 }, (_, i) => entry("fact", `Fact ${i}`)), entry("warning", "Prod is read-only")];
    expect(formatBrief({ project, agent: "cursor", entries, pendingCount: 0 })).toContain("Prod is read-only");
  });

  it("decisions come before facts", () => {
    const out = formatBrief({ project, agent: "a", entries: [entry("fact", "F1", 10), entry("decision", "D1", 10)], pendingCount: 0 });
    expect(out.indexOf("D1")).toBeLessThan(out.indexOf("F1"));
  });

  it("respects a custom budget", () => {
    const entries = Array.from({ length: 50 }, (_, i) => entry("fact", `Fact ${i}`));
    const out = formatBrief({ project, agent: "a", entries, pendingCount: 0, budgetTokens: 500 });
    expect(Math.ceil(out.length / 4)).toBeLessThanOrEqual(500);
  });

  it("uninitialised hint", () => {
    const out = formatBrief({ project: { ...project, initialized: false }, agent: "a", entries: [], pendingCount: 0 });
    expect(out).toContain("baglam init");
  });

  it("shows the marker warning", () => {
    const out = formatBrief({ project: { ...project, initialized: false, warning: "project.json is broken" }, agent: "a", entries: [], pendingCount: 0 });
    expect(out).toContain("project.json is broken");
  });

  it("counts records that were never fetched in the 'more' line", () => {
    const entries = [entry("decision", "D1", 10)];
    const out = formatBrief({ project, agent: "a", entries, pendingCount: 0, total: 41 });
    expect(out).toContain("40 more record(s) not shown");
  });

  it("says 'or more' when the total was capped", () => {
    const out = formatBrief({ project, agent: "a", entries: [entry("fact", "F", 10)], pendingCount: 0, total: 1000, totalCapped: true });
    expect(out).toContain("999+ more record(s) not shown");
  });

  const handoff = (over: Record<string, unknown> = {}) => ({
    project: "k", branch: "main", dir: "c:/app", taskId: "t1", goal: "Stripe checkout", status: "in_progress" as const,
    done: ["form"], now: "webhook", next: ["verify", "tests"], files: ["src/a.ts"], blockers: null, notes: null,
    agent: "claude-code", createdAt: Date.now() - 3_600_000, updatedAt: Date.now() - 600_000, expiresAt: Date.now() + 1e9, ...over,
  });

  it("done task shows 24 h then disappears", () => {
    const fresh = formatBrief({ project, agent: "a", entries: [], pendingCount: 0, handoff: { live: handoff({ status: "done" }), git: null, otherBranches: [] } });
    expect(fresh).toMatch(/Last task.*finished/);
    expect(fresh).not.toMatch(/Continue from here/);
    const old = formatBrief({ project, agent: "a", entries: [], pendingCount: 0, handoff: { live: handoff({ status: "done", updatedAt: Date.now() - 25 * 3_600_000 }), git: null, otherBranches: [] } });
    expect(old).not.toMatch(/Last task/);
  });

  it("brief stays within budget with a huge handoff and shows git changes", () => {
    const big = handoff({ done: Array.from({ length: 30 }, (_, i) => "d".repeat(290) + i), next: Array.from({ length: 20 }, () => "n".repeat(290)), notes: "x".repeat(2000) });
    const entries = Array.from({ length: 50 }, (_, i) => entry("fact", `Fact ${i}`));
    const git = { branch: "main", ahead: null, behind: null, changed: ["src/a.ts", "src/b.ts"], changedCount: 2, commitsSince: [] };
    const out = formatBrief({ project, agent: "cursor", entries, pendingCount: 0, handoff: { live: big, git, otherBranches: [] } });
    expect(Math.ceil(out.length / 4)).toBeLessThanOrEqual(2000);
    expect(out).toMatch(/Continue from here/);
    expect(out).toContain("Since then (git): 2 files changed");
    expect(out).toContain("Fact 0"); // durable records still get most of the budget
    expect(out).toMatch(/more record\(s\) not shown/);
  });
});

describe("automatic saving in the brief", () => {
  it("shows the latest request and says when only the tool saved the task", async () => {
    const { ContextStore } = await import("../src/store.js");
    const { formatHandoff } = await import("../src/format.js");
    const s = new ContextStore(":memory:");
    s.autoCapture({ project: "p", branch: "main", dir: "/tmp/p", agent: "claude-code", event: { kind: "prompt", text: "Add search" } });
    s.autoCapture({ project: "p", branch: "main", dir: "/tmp/p", agent: "codex", event: { kind: "prompt", text: "devam et" } });
    const text = formatHandoff({ live: s.getHandoff("p", "main")!, git: null, otherBranches: [] }, 6000);
    expect(text).toMatch(/Asked: devam et/);
    expect(text).toMatch(/Saved automatically from the tool; the agent has not checkpointed this task yet/);
    s.checkpoint({ project: "p", branch: "main", agent: "codex", agentVerified: true, now: "Writing search" });
    const after = formatHandoff({ live: s.getHandoff("p", "main")!, git: null, otherBranches: [] }, 6000);
    expect(after).not.toMatch(/Saved automatically/);
    expect(after).toMatch(/Asked: devam et/);
  });

  it("shows the full request that started the task, its lines kept", async () => {
    const { ContextStore } = await import("../src/store.js");
    const { formatHandoff } = await import("../src/format.js");
    const s = new ContextStore(":memory:");
    const plan = "Build Tıp Kartları.\nPart 2: study mode, Farmakoloji and Patoloji.\nPart 3: search.";
    s.autoCapture({ project: "p", branch: "main", dir: "/tmp/p", agent: "antigravity", event: { kind: "prompt", text: plan } });
    s.checkpoint({ project: "p", branch: "main", agent: "antigravity", agentVerified: true, goal: "Tıp Kartları", next: ["Part 2"] });
    const text = formatHandoff({ live: s.getHandoff("p", "main")!, git: null, otherBranches: [] }, 6000);
    expect(text).toContain(`The user's request that started this task:\n${plan}`);
  });
});

describe("no repeated request line", () => {
  it("Asked is left out when it is the task's own title", async () => {
    const { ContextStore } = await import("../src/store.js");
    const { formatHandoff } = await import("../src/format.js");
    const s = new ContextStore(":memory:");
    s.autoCapture({ project: "p", branch: "main", dir: "/tmp/p", agent: "cursor", event: { kind: "prompt", text: "Fatura PDF ekle" } });
    const text = formatHandoff({ live: s.getHandoff("p", "main")!, git: null, otherBranches: [] }, 6000);
    expect(text).not.toMatch(/Asked:/);
  });
});
