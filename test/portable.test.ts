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
    expect(r).toEqual({ imported: 4, approvedNow: 2, skipped: 0, blocked: [] });
    expect(dst.visible(P, "cursor").map((e) => e.title).sort()).toEqual(src.visible(P, "cursor").map((e) => e.title).sort());
    const old = data.entries.find((e) => e.title === "Use Postgres")!;
    expect(dst.get(old.id)?.status).toBe("superseded");
    expect(dst.history(old.id).map((h) => h.type)).toEqual([...src.history(old.id).map((h) => h.type), "imported"]);
    expect(dst.listProjects()[0]).toMatchObject({ key: P, name: "app" });
  });

  it("import is idempotent", () => {
    const data = exportJson(src, { project: P });
    const dst = new ContextStore(":memory:");
    importJson(dst, data, { by: "x" });
    expect(importJson(dst, data, { by: "x" })).toEqual({ imported: 0, approvedNow: 0, skipped: 4, blocked: [] });
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

describe("export / import at scale and edge cases", () => {
  const Q = "99999999-2222-4333-8444-555555555555";
  const fill = (s: ContextStore, project: string, n: number) => {
    for (let i = 0; i < n; i++) s.addApproved({ project, kind: "fact", title: `Fact ${i} ${project.slice(0, 4)}`, body: `Body ${i}` }, "human");
  };

  it("all-projects json export keeps every record of every project", () => {
    const s = new ContextStore(":memory:");
    s.touchProject({ key: P, name: "a", dir: "c:/a" });
    s.touchProject({ key: Q, name: "b", dir: "c:/b" });
    fill(s, P, 600);
    fill(s, Q, 600);
    expect(exportJson(s).entries).toHaveLength(1200);
  }, 60_000);

  it("md export includes every active record", () => {
    const s = new ContextStore(":memory:");
    s.touchProject({ key: P, name: "a", dir: "c:/a" });
    fill(s, P, 600);
    const md = exportMarkdown(s, P);
    expect(md).toContain("600 active record(s)");
    expect(md).toContain("### Fact 0 1111");
    expect(md).toContain("### Fact 599 1111");
  }, 60_000);

  it("md export escapes HTML in titles, reasons and tags", () => {
    const s = new ContextStore(":memory:");
    s.addApproved({ project: P, kind: "fact", title: "<img src=x onerror=alert(1)>", body: "b", rationale: "<b>why</b>", tags: ["<i>t</i>"] }, "human");
    const md = exportMarkdown(s, P);
    expect(md).not.toMatch(/<img|<b>|<i>/);
    expect(md).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("import records who imported each record and drops unknown event types", () => {
    const s = new ContextStore(":memory:");
    const data = {
      format: "baglam/1",
      entries: [{ id: "cimp00001", project: P, kind: "fact", title: "T", body: "B", status: "approved", sourceAgent: "a", createdAt: 1, decidedBy: "human:boss" }],
      events: [
        { entryId: "cimp00001", type: "approved", actor: "human:boss", at: 1, detail: null },
        { entryId: "cimp00001", type: "anything", actor: "x", at: 2, detail: null },
      ],
    };
    importJson(s, data, { by: "human:ev", source: "backup.json" });
    const h = s.history("cimp00001");
    expect(h.map((e) => e.type)).toEqual(["approved", "imported"]);
    expect(h.at(-1)).toMatchObject({ actor: "human:ev", detail: "backup.json" });
  });

  it("import restores an archived project", () => {
    const s = new ContextStore(":memory:");
    s.touchProject({ key: P, name: "app", dir: "c:/app" });
    s.archiveProject(P, "human");
    importJson(s, { format: "baglam/1", projects: [{ key: P, name: "app" }], entries: [] }, { by: "x" });
    expect(s.listProjects().map((p) => p.key)).toContain(P);
  });

  it("cli: import says how many records arrive already approved; md ignores no flags silently", () => {
    const dir = mkdtempSync(join(tmpdir(), "baglam-port2-"));
    const file = join(dir, "x.json");
    writeFileSync(file, JSON.stringify({ format: "baglam/1", entries: [{ id: "cimp00002", project: P, kind: "fact", title: "T", body: "B", status: "approved", sourceAgent: "a", createdAt: 1 }] }));
    const out: string[] = [];
    const dst = new ContextStore(":memory:");
    expect(runCli(["import", file], { store: dst, project: P, user: "human:ev", print: (s) => out.push(s) })).toBe(0);
    expect(out.join("\n")).toMatch(/1 of them (is|are) approved and visible to agents now/);
    out.length = 0;
    expect(runCli(["export", "--format", "md", "--all-projects"], { store: dst, project: P, user: "u", print: (s) => out.push(s) })).toBe(1);
    expect(out.join("\n")).toMatch(/one project at a time/);
  });
});
