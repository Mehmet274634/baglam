import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnsafeProjectDir, resolveDirectory, type ProjectRef } from "./project.js";

export type ResolvedVia = "project_path" | "env" | "roots" | "cwd";

export type Resolution =
  | { ok: true; project: ProjectRef; via: ResolvedVia }
  | { ok: false; reason: "unknown" | "ambiguous" | "invalid"; candidates: ProjectRef[]; message: string };

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

/** Why an explicit project_path cannot be used, or null when it can. */
function invalidProjectPath(p: string): string | null {
  if (!isAbsolute(p)) return `project_path must be an absolute path (got "${p}").`;
  if (!existsSync(p) || !statSync(p).isDirectory()) return `project_path ${p} does not exist or is not a folder.`;
  if (isUnsafeProjectDir(p)) {
    return `project_path ${p} is not allowed as a project (home, system or Bağlam's own folder). Pass your workspace folder.`;
  }
  return null;
}

/** Decide which project a tool call belongs to: project_path → env → client roots → cwd. */
export function resolveProjectFor(input: ResolveInput): Resolution {
  // An explicit project_path is the agent saying exactly where it is: use it or refuse, never guess past it.
  if (input.projectPath?.trim()) {
    const problem = invalidProjectPath(input.projectPath.trim());
    if (problem) return { ok: false, reason: "invalid", candidates: [], message: problem };
    return { ok: true, project: resolveDirectory(input.projectPath.trim()), via: "project_path" };
  }

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

  // The working directory is only a guess (GUI apps often start servers in their install folder):
  // accept it only when it is clearly a project.
  const fromCwd = safe(input.cwd);
  if (fromCwd && fromCwd.anchor !== "folder") return { ok: true, project: fromCwd, via: "cwd" };

  return { ok: false, reason: "unknown", candidates: [], message: UNKNOWN_MESSAGE };
}
