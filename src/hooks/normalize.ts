import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import type { AutoEvent } from "../capture.js";

/** The tools whose hooks Bağlam installs (ids match BAGLAM_AGENT ids written by setup). */
export const HOOK_CLIENTS = ["claude-code", "codex", "gemini-cli", "cursor", "antigravity", "vscode"] as const;
export type HookClient = (typeof HOOK_CLIENTS)[number];
export type HookEvent = "prompt" | "edit" | "stop";
export const HOOK_EVENTS: HookEvent[] = ["prompt", "edit", "stop"];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const first = (v: unknown): string | undefined => (Array.isArray(v) ? str(v[0]) : undefined);

/** Cursor sends Windows roots as "/c:/Users/...". */
const asPath = (p: string) => (/^\/[a-zA-Z]:[\\/]/.test(p) ? p.slice(1) : p);

const FILE_TOOLS: Partial<Record<HookClient, RegExp>> = {
  "claude-code": /^(Write|Edit|MultiEdit|NotebookEdit)$/,
  "gemini-cli": /^(write_file|replace)$/,
  // Antigravity 2: write_file, edit_file, create_file (args.Path); older versions: TargetFile.
  antigravity: /^(write_file|edit_file|create_file|write_to_file|replace_file_content|multi_replace_file_content)$/,
};

/** Paths named in a Codex apply_patch body. */
function patchFiles(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) out.push(m[1].trim());
  for (const m of patch.matchAll(/^\*\*\* Move to: (.+)$/gm)) out.push(m[1].trim());
  return out;
}

const TRANSCRIPT_TAIL = 256 * 1024;

/** The last assistant text in a Claude Code transcript (JSONL). Reads only the end of the file. */
function lastAssistantText(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, TRANSCRIPT_TAIL);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n").reverse();
    for (const line of lines) {
      let row: Obj | undefined;
      try {
        row = obj(JSON.parse(line));
      } catch {
        continue;
      }
      const msg = obj(row?.message);
      if (row?.type !== "assistant" || !msg) continue;
      const content = msg.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.map((c) => (obj(c)?.type === "text" ? str(obj(c)!.text) : undefined)).filter(Boolean).join("\n")
            : "";
      if (text.trim()) return text;
    }
  } catch {
    // An unreadable transcript just means no reply is saved.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return undefined;
}

/** Turn one tool's hook payload into what Bağlam saves. Never throws; unknown shapes give no event. */
export function normalize(client: HookClient, event: HookEvent, input: unknown): { cwd?: string; event?: AutoEvent } {
  const i = obj(input);
  if (!i) return {};
  const rawCwd = str(i.cwd) ?? first(i.workspace_roots) ?? first(i.workspacePaths);
  const cwd = rawCwd ? resolve(asPath(rawCwd)) : undefined;
  const base = cwd ?? process.cwd();
  const files = (list: (string | undefined)[]) => list.filter((f): f is string => !!f).map((f) => resolve(base, asPath(f)));
  const wrap = (e: AutoEvent | undefined) => (e ? { cwd, event: e } : { cwd });

  if (event === "prompt") {
    if (client === "antigravity") {
      // PreInvocation fires before every model call; only the first one of a turn carries a new request.
      if (i.invocationNum !== 0) return { cwd };
      const text = str(i.lastUserInput);
      return wrap(text ? { kind: "prompt", text } : undefined);
    }
    const text = str(i.prompt);
    return wrap(text ? { kind: "prompt", text } : undefined);
  }

  if (event === "edit") {
    let found: string[] = [];
    if (client === "cursor") {
      found = files([str(i.file_path)]);
    } else if (client === "antigravity") {
      const call = obj(i.toolCall);
      if (call && FILE_TOOLS.antigravity!.test(String(call.name))) {
        const args = obj(call.args);
        found = files([str(args?.TargetFile) ?? str(args?.Path)]);
      }
    } else if (client === "codex") {
      const command = str(obj(i.tool_input)?.command);
      if (i.tool_name === "apply_patch" && command) found = files(patchFiles(command));
    } else {
      const rule = FILE_TOOLS[client];
      if (rule && i.tool_name !== undefined && !rule.test(String(i.tool_name))) return { cwd };
      const args = obj(i.tool_input) ?? obj(i.toolArgs);
      found = files([str(args?.file_path) ?? str(args?.notebook_path) ?? str(args?.filePath) ?? str(args?.path)]);
    }
    return wrap(found.length ? { kind: "edit", files: found } : undefined);
  }

  let reply: string | undefined;
  if (client === "cursor") reply = str(i.text);
  else if (client === "gemini-cli") reply = str(i.prompt_response);
  else if (client === "antigravity") reply = undefined;
  else reply = str(i.last_assistant_message) ?? (client === "claude-code" && str(i.transcript_path) ? lastAssistantText(String(i.transcript_path)) : undefined);
  return wrap(reply ? { kind: "stop", reply } : undefined);
}

/** What the hook prints: never a block, never text the tool would add to the conversation. */
export function neutralOutput(client: HookClient, event: HookEvent): string {
  if (client === "cursor") return event === "prompt" ? '{"continue":true}' : "{}";
  if (client === "gemini-cli" || client === "antigravity") return "{}";
  return "";
}
