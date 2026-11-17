import { describe, it, expect, beforeEach } from "vitest";
import { ContextStore } from "../src/store.js";
import { runCli } from "../src/cli.js";
import { resolveProject } from "../src/project.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const P = "c:/work/app";

describe("baglam CLI", () => {
  let store: ContextStore;
  let out: string[];
  const run = (...argv: string[]) => {
    out = [];
    return runCli(argv, { store, project: P, user: "ev", print: (s) => out.push(s) });
  };
  const propose = (title = "Use pnpm") =>
    store.propose({ project: P, kind: "decision", title, body: "b", sourceAgent: "claude-code" });

  beforeEach(() => {
    store = new ContextStore(":memory:");
  });

  const AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

  it("add refuses a secret without --force", () => {
    expect(run("add", "fact", "Deploy key", `The key is ${AWS}`)).toBe(1);
    expect(out.join("\n")).toMatch(/looks like it contains a secret: AWS access key \(AKIA…\)/);
    expect(out.join("\n")).toMatch(/--force/);
    expect(store.all(P)).toEqual([]);
  });

  it("add --force stores it", () => {
    expect(run("add", "fact", "Deploy key", `The key is ${AWS}`, "--force")).toBe(0);
    expect(store.all(P)).toHaveLength(1);
  });

  it("trust add/list/remove", () => {
    expect(run("trust", "add", "--agent", "codex", "--kind", "fact")).toBe(0);
    expect(out.join("\n")).toMatch(/skip your review/);
    expect(out.join("\n")).toMatch(/secrets are always blocked/i);
    expect(out.join("\n")).not.toMatch(/secrets and duplicates still go to review/);
    expect(run("trust", "add", "--kind", "convention", "--global")).toBe(0);
    const rules = store.listTrustRules(P);
    expect(rules.map((r) => [r.projectId, r.agent, r.kind])).toEqual([[P, "codex", "fact"], [null, null, "convention"]]);
    expect(run("trust", "list")).toBe(0);
    const listed = out.join("\n");
    expect(listed).toContain(rules[0].id);
    expect(listed).toMatch(/all projects/);
    expect(run("trust", "remove", rules[0].id)).toBe(0);
    expect(store.listTrustRules(P)).toHaveLength(1);
    expect(run("trust", "remove", rules[0].id)).toBe(1);
  });

  it("trust add needs --agent or --kind", () => {
    expect(run("trust", "add")).toBe(1);
    expect(out.join("\n")).toMatch(/agent or kind/);
    expect(run("trust", "add", "--kind", "rumor")).toBe(1);
  });

  it("pending shows duplicate hints", () => {
    const a = propose("Use pnpm");
    const b = store.propose({ project: P, kind: "decision", title: "Use pnpm", body: "b", sourceAgent: "codex", similarTo: [a.id] });
    expect(run("pending")).toBe(0);
    expect(out.join("\n")).toMatch(new RegExp(`possible duplicate of ${a.id}`));
    void b;
  });

  it("pending lists proposals with ids", () => {
    const e = propose();
    expect(run("pending")).toBe(0);
    expect(out.join("\n")).toContain(e.id);
    expect(out.join("\n")).toContain("claude-code");
  });

  it("approve marks entries approved by the current user", () => {
    const a = propose("a");
    const b = propose("b");
    expect(run("approve", a.id, b.id)).toBe(0);
    expect(store.get(a.id)?.status).toBe("approved");
    expect(store.get(b.id)?.decidedBy).toBe("ev");
  });

  it("approve --all only touches the current project", () => {
    propose();
    const other = store.propose({ project: "c:/x", kind: "fact", title: "t", body: "b", sourceAgent: "a" });
    expect(run("approve", "--all")).toBe(0);
    expect(store.pending(P)).toHaveLength(0);
    expect(store.get(other.id)?.status).toBe("proposed");
  });

  it("reject stores the note", () => {
    const e = propose();
    expect(run("reject", e.id, "--note", "we use npm")).toBe(0);
    expect(store.get(e.id)?.decisionNote).toBe("we use npm");
  });

  it("add creates an approved human entry with options", () => {
    expect(run("add", "warning", "Prod DB is read-only", "Never run migrations from agents.", "--ttl", "30", "--to", "cursor,codex")).toBe(0);
    const [e] = store.visible(P, "cursor");
    expect(e.title).toBe("Prod DB is read-only");
    expect(e.sourceAgent).toBe("ev");
    expect(e.audience).toEqual(["cursor", "codex"]);
    expect(e.expiresAt).not.toBeNull();
  });

  it("--project=<path> (with =) selects that project", () => {
    const other = mkdtempSync(join(tmpdir(), "baglam-cli-"));
    const key = resolveProject(other);
    const e = store.propose({ project: key, kind: "fact", title: "t", body: "b", sourceAgent: "a" });
    propose();
    expect(run("approve", "--all", `--project=${other}`)).toBe(0);
    expect(store.get(e.id)?.status).toBe("approved");
    expect(store.pending(P)).toHaveLength(1);
  });

  it("returns non-zero with a message on errors and unknown commands", () => {
    expect(run("approve", "cnope")).toBe(1);
    expect(out.join("\n")).toMatch(/unknown entry/);
    expect(run("frobnicate")).toBe(1);
    expect(out.join("\n")).toMatch(/usage/i);
  });
});
