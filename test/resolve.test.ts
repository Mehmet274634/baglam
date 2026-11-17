import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMarker } from "../src/project.js";
import { normalizeProject } from "../src/config.js";
import { resolveProjectFor } from "../src/resolve.js";

const tmp = () => mkdtempSync(join(tmpdir(), "baglam-res-"));
const uri = (d: string) => pathToFileURL(d).href;

describe("resolveProjectFor", () => {
  it("project_path wins over env and roots", () => {
    const a = tmp(), b = tmp(), c = tmp();
    const r = resolveProjectFor({ projectPath: a, env: b, roots: [uri(c)], cwd: homedir() });
    expect(r).toMatchObject({ ok: true, via: "project_path" });
    if (r.ok) expect(r.project.key).toBe(normalizeProject(a));
  });

  it("env wins over roots and cwd", () => {
    const b = tmp(), c = tmp();
    const r = resolveProjectFor({ env: b, roots: [uri(c)], cwd: tmp() });
    expect(r).toMatchObject({ ok: true, via: "env" });
  });

  it("refuses writes when the only candidate is the home folder", () => {
    const r = resolveProjectFor({ cwd: homedir() });
    expect(r).toMatchObject({ ok: false, reason: "unknown" });
    if (!r.ok) expect(r.message).toMatch(/project_path/);
  });

  it("skips an unsafe project_path and falls through", () => {
    const d = tmp();
    const r = resolveProjectFor({ projectPath: homedir(), cwd: d });
    expect(r).toMatchObject({ ok: true, via: "cwd" });
  });

  it("ambiguous roots", () => {
    const a = tmp(), b = tmp();
    createMarker(a);
    createMarker(b);
    const r = resolveProjectFor({ roots: [uri(a), uri(b)], cwd: homedir() });
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    if (!r.ok) expect(r.candidates).toHaveLength(2);
  });

  it("two plain roots are ambiguous too", () => {
    const r = resolveProjectFor({ roots: [uri(tmp()), uri(tmp())], cwd: homedir() });
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("prefers the initialised root", () => {
    const a = tmp(), b = tmp();
    const { key } = createMarker(a);
    const r = resolveProjectFor({ roots: [uri(b), uri(a)], cwd: homedir() });
    expect(r).toMatchObject({ ok: true, via: "roots" });
    if (r.ok) expect(r.project.key).toBe(key);
  });

  it("roots inside the same project collapse to one", () => {
    const a = tmp();
    const { key } = createMarker(a);
    const r = resolveProjectFor({ roots: [uri(a), uri(join(a, "sub"))], cwd: homedir() });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.project.key).toBe(key);
  });

  it("ignores non-file roots", () => {
    const r = resolveProjectFor({ roots: ["https://example.com/x"], cwd: homedir() });
    expect(r).toMatchObject({ ok: false, reason: "unknown" });
  });
});
