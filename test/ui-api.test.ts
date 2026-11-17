import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { apiHarness, type ApiHarness } from "./ui-helpers.js";

const A = "11111111-2222-4333-8444-555555555555";
const AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

describe("panel API", () => {
  let h: ApiHarness;
  beforeEach(async () => {
    h = await apiHarness();
    h.store.touchProject({ key: A, name: "app", dir: "c:/work/app" });
  });
  afterEach(() => h.close());

  const propose = (title = "Use pnpm", extra: Record<string, unknown> = {}) =>
    h.store.propose({ project: A, kind: "convention", title, body: `${title} body`, sourceAgent: "claude-code", ...extra });

  it("overview lists user, projects, pending total and tools", async () => {
    mkdirSync(join(h.host.home, ".cursor"));
    propose();
    const r = await h.call("GET", "/api/overview");
    expect(r.status).toBe(200);
    expect(r.json.user).toBe("human:ev");
    expect(r.json.pendingTotal).toBe(1);
    expect(r.json.projects.map((p: { key: string }) => p.key)).toEqual([A]);
    expect(r.json.tools).toEqual([{ id: "cursor", label: "Cursor", registered: false }]);
  });

  it("pending includes similar records", async () => {
    const a = propose();
    const b = h.store.propose({ project: A, kind: "convention", title: "Use pnpm", body: "x", sourceAgent: "codex", similarTo: [a.id] });
    const r = await h.call("GET", `/api/pending?project=${A}`);
    const item = r.json.items.find((x: { id: string }) => x.id === b.id);
    expect(item.similar.map((s: { id: string }) => s.id)).toEqual([a.id]);
    expect((await h.call("GET", "/api/pending")).json.items).toHaveLength(2);
  });

  it("approve, reject and approve-all", async () => {
    const a = propose("One alpha");
    const b = propose("Two beta");
    const c = propose("Three gamma");
    expect((await h.call("POST", `/api/entries/${a.id}/approve`, { note: "ok" })).status).toBe(200);
    expect(h.store.get(a.id)?.decidedBy).toBe("human:ev");
    expect((await h.call("POST", `/api/entries/${b.id}/reject`, { note: "no" })).json.status).toBe("rejected");
    const late = propose("Four delta arrived later");
    const all = await h.call("POST", "/api/approve-all", { ids: [c.id] });
    expect(all.json).toEqual({ approved: 1, skipped: 0 });
    expect(h.store.get(c.id)?.status).toBe("approved");
    expect(h.store.get(late.id)?.status).toBe("proposed");
    expect((await h.call("POST", "/api/approve-all", { project: A })).status).toBe(400);
  });

  it("approving a decided proposal is a 409", async () => {
    const a = propose();
    await h.call("POST", `/api/entries/${a.id}/approve`, {});
    const again = await h.call("POST", `/api/entries/${a.id}/approve`, {});
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/not pending/);
  });

  it("busy database is a 503 with a plain message", async () => {
    const { statusFor } = await import("../src/ui/http.js");
    expect(statusFor(new Error("database is locked"))).toBe(503);
    expect(statusFor(new Error("database table is locked"))).toBe(503);
  });

  it("edit and approve happen in one step", async () => {
    const a = propose();
    const r = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: "new" }, approve: true });
    expect(r.status).toBe(200);
    expect(h.store.history(a.id).map((x) => x.type)).toEqual(["proposed", "edited", "approved"]);
    expect(typeof h.store.editAndApprove).toBe("function");
  });

  it("unknown entry is a 404", async () => {
    expect((await h.call("POST", "/api/entries/cnope/approve", {})).status).toBe(404);
  });

  it("edit with a secret is 409 unless force; edit+approve in one go", async () => {
    const a = propose();
    const blocked = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: `key ${AWS}` } });
    expect(blocked.status).toBe(409);
    expect(blocked.json.secrets[0]).toMatchObject({ type: "AWS access key", masked: "AKIA…" });
    expect(h.store.get(a.id)?.body).toBe("Use pnpm body");
    const ok = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: "Use pnpm 9" }, approve: true });
    expect(ok.status).toBe(200);
    expect(h.store.get(a.id)).toMatchObject({ body: "Use pnpm 9", status: "approved" });
    const forced = await h.call("POST", `/api/entries/${a.id}/edit`, { patch: { body: `key ${AWS}` }, force: true });
    expect(forced.status).toBe(200);
  });

  it("retire and entry detail with history", async () => {
    const a = propose();
    h.store.approve(a.id, "human:ev");
    expect((await h.call("POST", `/api/entries/${a.id}/retire`, { note: "old" })).json.status).toBe("retired");
    const d = await h.call("GET", `/api/entries/${a.id}`);
    expect(d.json.entry.status).toBe("retired");
    expect(d.json.history.map((x: { type: string }) => x.type)).toEqual(["proposed", "approved", "retired"]);
  });

  it("records query", async () => {
    h.store.approve(propose("Zebra rule").id, "human:ev");
    propose("Pending lion");
    const r = await h.call("GET", `/api/records?project=${A}&status=active&q=zebra`);
    expect(r.json.total).toBe(1);
    expect(r.json.items[0].title).toBe("Zebra rule");
    expect((await h.call("GET", `/api/records?project=${A}&limit=1&offset=1`)).json.items).toHaveLength(1);
    expect((await h.call("GET", "/api/records?status=bogus")).status).toBe(400);
  });

  it("project rename, archive, restore", async () => {
    expect((await h.call("POST", `/api/projects/${A}/rename`, { name: "Main app" })).status).toBe(200);
    await h.call("POST", `/api/projects/${A}/archive`, {});
    expect((await h.call("GET", "/api/overview")).json.projects).toEqual([]);
    expect((await h.call("GET", "/api/projects?archived=1")).json.items[0]).toMatchObject({ name: "Main app", archived: true });
    await h.call("POST", `/api/projects/${A}/restore`, {});
    expect((await h.call("GET", "/api/overview")).json.projects[0].name).toBe("Main app");
  });

  it("delete needs the project name", async () => {
    h.store.approve(propose().id, "human:ev");
    expect((await h.call("DELETE", `/api/projects/${A}`, { confirm: "wrong" })).status).toBe(400);
    const ok = await h.call("DELETE", `/api/projects/${A}`, { confirm: "app" });
    expect(ok.json).toEqual({ deleted: 1 });
  });

  it("trust rules list/add/remove", async () => {
    const added = await h.call("POST", "/api/trust", { projectId: A, agent: "codex", kind: "fact" });
    expect(added.status).toBe(200);
    expect((await h.call("POST", "/api/trust", { projectId: null })).status).toBe(400);
    const list = await h.call("GET", `/api/trust?project=${A}`);
    expect(list.json.items.map((r: { id: string }) => r.id)).toEqual([added.json.id]);
    expect((await h.call("DELETE", `/api/trust/${added.json.id}`)).status).toBe(200);
    expect((await h.call("DELETE", `/api/trust/${added.json.id}`)).status).toBe(404);
  });
});
