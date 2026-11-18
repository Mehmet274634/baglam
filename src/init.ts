import { join, resolve } from "node:path";
import type { ContextStore } from "./store.js";
import type { HostEnv } from "./host.js";
import type { Change } from "./clients/types.js";
import { antigravity, cursor, geminiCli } from "./clients/json.js";
import { claudeCode } from "./clients/claude.js";
import { normalizeProject } from "./config.js";
import { createMarker, readMarker, resolveDirectory, type ProjectRef } from "./project.js";
import { CURSOR_RULE_HEADER, instructionBlock, removeBlock, upsertBlock } from "./instructions.js";

export interface InitResult {
  project: ProjectRef;
  /** Records moved from the folder's old path key to the new project id. */
  moved: number;
  changes: Change[];
}

interface InstructionTarget {
  file: string;
  prefix?: string;
}

function targets(dir: string, host: HostEnv): InstructionTarget[] {
  const detected = (c: { detect(h: HostEnv): boolean }) => {
    try {
      return c.detect(host);
    } catch {
      return false;
    }
  };
  const all = allTargets(dir);
  const list: InstructionTarget[] = [];
  if (detected(claudeCode)) list.push(all.claude);
  list.push(all.agents); // read by Codex, Cursor, Antigravity and most other agents
  if (detected(antigravity) || detected(geminiCli)) list.push(all.gemini);
  if (detected(cursor)) list.push(all.cursorRule);
  return list;
}

function allTargets(dir: string): Record<"claude" | "agents" | "gemini" | "cursorRule", InstructionTarget> {
  return {
    claude: { file: join(dir, "CLAUDE.md") },
    agents: { file: join(dir, "AGENTS.md") },
    gemini: { file: join(dir, "GEMINI.md") },
    cursorRule: { file: join(dir, ".cursor", "rules", "baglam.mdc"), prefix: CURSOR_RULE_HEADER },
  };
}

export interface InitOptions {
  store: ContextStore;
  host: HostEnv;
  undo?: boolean;
  /** Make this folder its own project even though it sits inside another one. */
  here?: boolean;
}

/**
 * Prepare a folder for Bağlam: give it a stable identity, move records saved under its old path key,
 * and write the instructions agents read. With `undo`, remove the instructions (the identity stays).
 */
export function runInit(dir: string, opts: InitOptions): InitResult {
  const target = resolve(dir);
  const before = resolveDirectory(target);

  if (opts.undo) {
    // Undo never creates an identity; it only removes what init wrote, from every place init can write.
    const changes = Object.values(allTargets(target)).map((t): Change => ({
      client: "init",
      file: t.file,
      action: removeBlock(t.file, { prefix: t.prefix }),
    }));
    return { project: before, moved: 0, changes };
  }

  const belongsElsewhere = normalizeProject(before.dir) !== normalizeProject(target);
  if (belongsElsewhere && !opts.here) {
    throw new Error(
      `This folder is inside project "${before.name}" at ${before.dir}. Run "baglam init" there, ` +
        `or add --here to make this folder a separate project.`,
    );
  }

  // A broken marker (hand-edited, merge conflict): reuse the id this folder was last seen with.
  const current = readMarker(target);
  const previous =
    current && "error" in current
      ? opts.store.listProjects({ includeArchived: true }).find((p) => p.path && normalizeProject(p.path) === normalizeProject(target))
      : undefined;
  // Throws for home/system folders before anything is written.
  const project = createMarker(target, previous ? { id: previous.key, name: previous.name } : undefined);
  // Always try: idempotent, and it finishes a move an earlier init could not complete.
  const moved = opts.store.rekeyProject(normalizeProject(target), project.key);
  opts.store.touchProject(project);
  const block = instructionBlock();
  const changes = targets(target, opts.host).map((t): Change => ({
    client: "init",
    file: t.file,
    action: upsertBlock(t.file, block, { prefix: t.prefix }),
  }));
  return { project, moved, changes };
}
