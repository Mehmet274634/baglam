import { join, resolve } from "node:path";
import type { ContextStore } from "./store.js";
import type { HostEnv } from "./host.js";
import type { Change } from "./clients/types.js";
import { antigravity, cursor, geminiCli } from "./clients/json.js";
import { createMarker, resolveDirectory, type ProjectRef } from "./project.js";
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
  const list: InstructionTarget[] = [{ file: join(dir, "CLAUDE.md") }, { file: join(dir, "AGENTS.md") }];
  if (detected(antigravity) || detected(geminiCli)) list.push({ file: join(dir, "GEMINI.md") });
  if (detected(cursor)) list.push({ file: join(dir, ".cursor", "rules", "baglam.mdc"), prefix: CURSOR_RULE_HEADER });
  return list;
}

/**
 * Prepare a folder for Bağlam: give it a stable identity, move records saved under its old path key,
 * and write the instructions agents read. With `undo`, remove the instructions (the identity stays).
 */
export function runInit(dir: string, opts: { store: ContextStore; host: HostEnv; undo?: boolean }): InitResult {
  const target = resolve(dir);
  const before = resolveDirectory(target);
  const project = createMarker(target); // throws for home/system folders before anything is written

  if (opts.undo) {
    const changes = targets(target, opts.host).map((t): Change => ({
      client: "init",
      file: t.file,
      action: removeBlock(t.file, { prefix: t.prefix }),
    }));
    return { project, moved: 0, changes };
  }

  const moved = before.initialized ? 0 : opts.store.rekeyProject(before.key, project.key);
  opts.store.touchProject(project);
  const block = instructionBlock();
  const changes = targets(target, opts.host).map((t): Change => ({
    client: "init",
    file: t.file,
    action: upsertBlock(t.file, block, { prefix: t.prefix }),
  }));
  return { project, moved, changes };
}
