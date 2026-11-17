import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("createMarker refuses unsafe folders", () => {
    expect(() => createMarker(homedir())).toThrow(/cannot be a project/);
  });

  it("markers in unsafe folders are ignored when walking up", () => {
    // The package root is an unsafe folder we may write to; a marker there must not capture its children.
    const markerDir = join(packageRoot, ".baglam");
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, "project.json"), JSON.stringify({ id: "11111111-2222-4333-8444-555555555555", name: "x" }));
    try {
      const ref = resolveDirectory(join(packageRoot, "test"));
      expect(ref.key).not.toBe("11111111-2222-4333-8444-555555555555");
      expect(ref.initialized).toBe(false);
    } finally {
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  it("normalises Unicode so NFC and NFD paths give the same key", () => {
    const nfc = "C:/work/BA\u011ELAM";
    const nfd = "C:/work/BAG\u0306LAM";
    expect(normalizeProject(nfd)).toBe(normalizeProject(nfc));
  });

  it("isUnsafeProjectDir flags home, filesystem root and the package itself", () => {
    expect(isUnsafeProjectDir(homedir())).toBe(true);
    expect(isUnsafeProjectDir(parse(process.cwd()).root)).toBe(true);
    expect(isUnsafeProjectDir(packageRoot)).toBe(true);
    expect(isUnsafeProjectDir(tmp())).toBe(false);
    if (process.platform === "win32") {
      expect(isUnsafeProjectDir(process.env.WINDIR ?? "C:\\Windows")).toBe(true);
      expect(isUnsafeProjectDir(join(process.env.WINDIR ?? "C:\\Windows", "System32"))).toBe(true);
    }
  });
});
