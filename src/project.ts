import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, normalizeProject } from "./config.js";

export interface ProjectRef {
  /** Marker id when initialised, else the normalised folder path (v0.1 key). */
  key: string;
  name: string;
  /** Folder the project lives in (marker folder, git root or the folder itself). */
  dir: string;
  initialized: boolean;
  /** Set when a marker exists but cannot be used. */
  warning?: string;
}

const MARKER_DIR = ".baglam";
const MARKER_FILE = "project.json";
const markerPath = (dir: string) => join(dir, MARKER_DIR, MARKER_FILE);

/** Bağlam's own package folder (works from both src/ and dist/). */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Read `<dir>/.baglam/project.json`. null = no marker; `{ error }` = present but unusable. */
export function readMarker(dir: string): { id: string; name: string } | { error: string } | null {
  const file = markerPath(dir);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown; name?: unknown };
    if (typeof data.id !== "string" || !data.id.trim()) return { error: `${file} has no "id"` };
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : basename(dir);
    return { id: data.id.trim(), name };
  } catch (err) {
    return { error: `${file} is not valid JSON (${(err as Error).message})` };
  }
}

/** True for folders that must never be treated as a project. */
export function isUnsafeProjectDir(dir: string): boolean {
  const p = normalizeProject(dir);
  return (
    p === normalizeProject(homedir()) ||
    p === normalizeProject(parse(resolve(dir)).root) ||
    p === normalizeProject(PACKAGE_ROOT)
  );
}

/** Nearest folder at or above `start` holding a marker (usable or not). */
function findMarkerDir(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(markerPath(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Map any folder to its project: nearest marker, else git root, else the folder itself. */
export function resolveDirectory(dir: string): ProjectRef {
  const start = resolve(dir);
  const markerDir = findMarkerDir(start);
  let warning: string | undefined;
  if (markerDir) {
    const marker = readMarker(markerDir);
    if (marker && "id" in marker) {
      return { key: marker.id, name: marker.name, dir: markerDir, initialized: true };
    }
    warning = `Ignoring ${marker?.error ?? markerPath(markerDir)}. Run "baglam init" to repair it.`;
  }
  let root = findProjectRoot(start);
  // A git repo at the home folder (dotfiles) must not swallow every project below it.
  if (isUnsafeProjectDir(root) && !isUnsafeProjectDir(start)) root = start;
  return { key: normalizeProject(root), name: basename(root) || root, dir: root, initialized: false, warning };
}

/** Give `dir` a stable identity. Keeps an existing valid marker; replaces a corrupt one. */
export function createMarker(dir: string): ProjectRef {
  const target = resolve(dir);
  const existing = readMarker(target);
  if (existing && "id" in existing) {
    return { key: existing.id, name: existing.name, dir: target, initialized: true };
  }
  const marker = { id: randomUUID(), name: basename(target) };
  mkdirSync(join(target, MARKER_DIR), { recursive: true });
  writeFileSync(markerPath(target), JSON.stringify(marker, null, 2) + "\n");
  return { key: marker.id, name: marker.name, dir: target, initialized: true };
}

/** Project key for CLI use: explicit path or BAGLAM_PROJECT, else the folder containing cwd. */
export function resolveProject(explicit?: string, cwd = process.cwd()): string {
  const fromEnv = explicit ?? process.env.BAGLAM_PROJECT;
  return resolveDirectory(fromEnv?.trim() ? fromEnv : cwd).key;
}
