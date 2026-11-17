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
});
