import { fileURLToPath } from "node:url";
import { isUnsafeProjectDir, resolveDirectory, type ProjectRef } from "./project.js";

export type ResolvedVia = "project_path" | "env" | "roots" | "cwd";

export type Resolution =
  | { ok: true; project: ProjectRef; via: ResolvedVia }
  | { ok: false; reason: "unknown" | "ambiguous"; candidates: ProjectRef[]; message: string };

export interface ResolveInput {
  /** Workspace folder the agent passed in the tool call. */
  projectPath?: string;
  /** BAGLAM_PROJECT from the server's environment. */
  env?: string;
  /** Root URIs reported by the MCP client. */
  roots?: string[];
  /** The server process's working directory. */
  cwd: string;
}

const UNKNOWN_MESSAGE =
  "Bağlam could not tell which project you are working in. Pass project_path with the absolute path of your workspace folder.";

function safe(dir: string | undefined): ProjectRef | null {
  if (!dir?.trim() || isUnsafeProjectDir(dir)) return null;
  return resolveDirectory(dir);
}

function rootToPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** Decide which project a tool call belongs to: project_path → env → client roots → cwd. */
export function resolveProjectFor(input: ResolveInput): Resolution {
  const explicit = safe(input.projectPath);
  if (explicit) return { ok: true, project: explicit, via: "project_path" };

  const fromEnv = safe(input.env);
  if (fromEnv) return { ok: true, project: fromEnv, via: "env" };

  const byKey = new Map<string, ProjectRef>();
  for (const uri of input.roots ?? []) {
    const ref = safe(rootToPath(uri) ?? undefined);
    if (ref && !byKey.has(ref.key)) byKey.set(ref.key, ref);
  }
  let candidates = [...byKey.values()];
  const initialised = candidates.filter((c) => c.initialized);
  if (initialised.length) candidates = initialised;
  if (candidates.length === 1) return { ok: true, project: candidates[0], via: "roots" };
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates,
      message:
        `Your workspace has several projects (${candidates.map((c) => c.dir).join(", ")}). ` +
        "Pass project_path with the one you are working in.",
    };
  }

  const fromCwd = safe(input.cwd);
  if (fromCwd) return { ok: true, project: fromCwd, via: "cwd" };

  return { ok: false, reason: "unknown", candidates: [], message: UNKNOWN_MESSAGE };
}
