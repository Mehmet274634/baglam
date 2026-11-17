import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarker, isUnsafeProjectDir, readMarker, resolveDirectory } from "../src/project.js";
import { normalizeProject } from "../src/config.js";

const tmp = () => mkdtempSync(join(tmpdir(), "baglam-proj-"));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("project identity", () => {
  it("uses the marker id as key", () => {
    const d = tmp();
    createMarker(d);
    const marker = JSON.parse(readFileSync(join(d, ".baglam", "project.json"), "utf8"));
    const ref = resolveDirectory(d);
    expect(ref.key).toBe(marker.id);
    expect(ref.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(ref.initialized).toBe(true);
    expect(ref.name).toBe(marker.name);
  });

  it("walks up to the marker", () => {
    const d = tmp();
    const { key } = createMarker(d);
    const deep = join(d, "src", "deep");
    mkdirSync(deep, { recursive: true });
    const ref = resolveDirectory(deep);
    expect(ref.key).toBe(key);
    expect(normalizeProject(ref.dir)).toBe(normalizeProject(d));
  });

  it("falls back to git root then dir", () => {
    const repo = tmp();
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "pkg"));
    const viaGit = resolveDirectory(join(repo, "pkg"));
    expect(viaGit.key).toBe(normalizeProject(repo));
    expect(viaGit.initialized).toBe(false);

    const plain = tmp();
    expect(resolveDirectory(plain).key).toBe(normalizeProject(plain));
  });

  it("ignores a corrupt marker", () => {
    const d = tmp();
    mkdirSync(join(d, ".baglam"));
    writeFileSync(join(d, ".baglam", "project.json"), "{oops");
    expect(readMarker(d)).toHaveProperty("error");
    const ref = resolveDirectory(d);
    expect(ref.initialized).toBe(false);
    expect(ref.warning).toMatch(/project\.json/);
  });

  it("treats a marker without an id as corrupt", () => {
    const d = tmp();
    mkdirSync(join(d, ".baglam"));
    writeFileSync(join(d, ".baglam", "project.json"), JSON.stringify({ name: "x" }));
    expect(resolveDirectory(d).initialized).toBe(false);
  });

  it("createMarker is idempotent", () => {
    const d = tmp();
    expect(createMarker(d).key).toBe(createMarker(d).key);
  });

  it("isUnsafeProjectDir flags home, filesystem root and the package itself", () => {
    expect(isUnsafeProjectDir(homedir())).toBe(true);
    expect(isUnsafeProjectDir(parse(process.cwd()).root)).toBe(true);
    expect(isUnsafeProjectDir(packageRoot)).toBe(true);
    expect(isUnsafeProjectDir(tmp())).toBe(false);
  });
});
