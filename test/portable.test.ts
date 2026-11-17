import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextStore } from "../src/store.js";
import { exportJson, exportMarkdown, importJson } from "../src/portable.js";
import { runCli } from "../src/cli.js";

const P = "11111111-2222-4333-8444-555555555555";
const AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

describe("export / import", () => {
  let src: ContextStore;
  beforeEach(() => {
    src = new ContextStore(":memory:");
    src.touchProject({ key: P, name: "app", dir: "c:/work/app" });
    const d = src.addApproved({ project: P, kind: "decision", title: "Use Postgres", body: "Primary DB is Postgres 16.", rationale: "Team knows it", tags: ["db"] }, "human:ev");
    src.addApproved({ project: P, kind: "warning", title: "Prod is read-only", body: "Never migrate prod from an agent.\n# not a heading" }, "human:ev");
    src.propose({ project: P, kind: "fact", title: "Pending fact", body: "b", sourceAgent: "codex" });
    src.approve(src.propose({ project: P, kind: "decision", title: "Use MySQL", body: "Switched.", sourceAgent: "codex", supersedes: d.id }).id, "human:ev");
  });

  it("json export round-trips into an empty db", () => {
    const data = exportJson(src, { project: P });
    expect(data.format).toBe("baglam/1");
    expect(data.projects).toEqual([{ key: P, name: "app" }]);
    expect(data.entries).toHaveLength(4);
    const dst = new ContextStore(":memory:");
    const r = importJson(dst, JSON.parse(JSON.stringify(data)), { by: "human:ev" });
    expect(r).toEqual({ imported: 4, skipped: 0, blocked: [] });
    expect(dst.visible(P, "cursor").map((e) => e.title).sort()).toEqual(src.visible(P, "cursor").map((e) => e.title).sort());
    const old = data.entries.find((e) => e.title === "Use Postgres")!;
    expect(dst.get(old.id)?.status).toBe("superseded");
    expect(dst.history(old.id).map((h) => h.type)).toEqual(src.history(old.id).map((h) => h.type));
    expect(dst.listProjects()[0]).toMatchObject({ key: P, name: "app" });
  });

  it("import is idempotent", () => {
    const data = exportJson(src, { project: P });
    const dst = new ContextStore(":memory:");
    importJson(dst, data, { by: "x" });
    expect(importJson(dst, data, { by: "x" })).toEqual({ imported: 0, skipped: 4, blocked: [] });
    expect(dst.query({ project: P }).total).toBe(4);
  });

  it("import tolerates unknown and missing optional fields", () => {
    const dst = new ContextStore(":memory:");
    const r = importJson(
      dst,
      {
        format: "baglam/1",
        futureField: true,
        entries: [
          { id: "cimport01", project: P, kind: "fact", title: "Minimal", body: "only required fields", status: "approved", sourceAgent: "human", createdAt: 1, extra: "x" },
          { id: "cimport02", project: P, kind: "nonsense", title: "Bad kind", body: "b", status: "approved", sourceAgent: "a", createdAt: 1 },
          { title: "no id" },
        ],
      },
      { by: "x" },
    );
    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(2);
    expect(dst.get("cimport01")).toMatchObject({ title: "Minimal", tags: [], audience: ["*"] });
  });

  it("rejects files that are not Bağlam exports", () => {
    expect(() => importJson(new ContextStore(":memory:"), { hello: 1 }, { by: "x" })).toThrow(/not a Bağlam export/);
  });

  it("import blocks secrets unless --force", () => {
    const data = { format: "baglam/1", entries: [{ id: "csecret01", project: P, kind: "fact", title: "Key", body: `use ${AWS}`, status: "approved", sourceAgent: "a", createdAt: 1 }] };
    const dst = new ContextStore(":memory:");
    const r = importJson(dst, data, { by: "x" });
    expect(r.imported).toBe(0);
    expect(r.blocked[0]).toMatchObject({ id: "csecret01" });
    expect(importJson(dst, data, { by: "x", force: true }).imported).toBe(1);
  });

  it("md export groups active records by kind and quotes bodies", () => {
    const md = exportMarkdown(src, P);
    expect(md).toMatch(/^# Shared project context: app/);
    expect(md.indexOf("## Warnings")).toBeLessThan(md.indexOf("## Decisions"));
    expect(md).toContain("### Use MySQL");
    expect(md).not.toContain("Use Postgres"); // superseded
    expect(md).not.toContain("Pending fact");
    expect(md).toContain("> # not a heading");
    expect(md).not.toMatch(/^# not a heading/m);
  });

  it("cli export/import", () => {
    const dir = mkdtempSync(join(tmpdir(), "baglam-port-"));
    const file = join(dir, "out.json");
    const out: string[] = [];
    const ctx = (store: ContextStore) => ({ store, project: P, user: "human:ev", print: (s: string) => out.push(s) });
    expect(runCli(["export", "--format", "json", "--out", file], ctx(src))).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).entries).toHaveLength(4);
    const dst = new ContextStore(":memory:");
    expect(runCli(["import", file], ctx(dst))).toBe(0);
    expect(out.join("\n")).toMatch(/Imported 4/);
    out.length = 0;
    expect(runCli(["export", "--format", "md"], ctx(src))).toBe(0);
    expect(out.join("\n")).toContain("# Shared project context");
    writeFileSync(join(dir, "bad.json"), "{nope");
    expect(runCli(["import", join(dir, "bad.json")], ctx(dst))).toBe(1);
  });
});
