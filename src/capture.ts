import { isAbsolute, relative, resolve } from "node:path";
import { scanEntryFields } from "./guards.js";
import { LIMITS, type CheckpointInput, type Handoff } from "./handoff.js";

/** What a tool hook saw, already translated from the tool's own format. */
export type AutoEvent =
  | { kind: "prompt"; text: string }
  | { kind: "edit"; files: string[] }
  | { kind: "stop"; reply: string };

export const HIDDEN = "(hidden: looked like a secret)";
/** A request on a task nobody touched for this long starts a new task instead of joining it. */
export const STALE_TASK_MS = 12 * 3_600_000;
const REPLY_PREFIX = "Last reply: ";
const DUPLICATE_MS = 60_000;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Scan a bit past the cut, so a secret the size limit would split is still seen whole; then cut. */
const SCAN_MARGIN = 256;
const keep = (s: string, max: number) =>
  scanEntryFields({ title: s.slice(0, max + SCAN_MARGIN), body: "", tags: [] }).length ? HIDDEN : s.slice(0, max);

/**
 * The checkpoint a hook event turns into, or null when there is nothing to save.
 * Never touches status, done, next, blockers or notes: those stay the agent's.
 */
export function planAutoEvent(
  existing: Handoff | undefined,
  event: AutoEvent,
  ctx: { now: number; dir: string },
): Omit<CheckpointInput, "project" | "branch" | "agent"> | null {
  const live = existing && existing.status !== "done" ? existing : undefined;

  if (event.kind === "prompt") {
    const first = String(event.text ?? "").split(/\r?\n/).map(oneLine).find(Boolean);
    if (!first) return null;
    const line = keep(first, LIMITS.goal);
    const stale = live && ctx.now - live.updatedAt > STALE_TASK_MS;
    if (!live || stale) {
      // The whole request too: a plan in it must reach the next agent even when the notes are vague.
      const full = String(event.text ?? "").trim();
      const request = full !== first ? keep(full, LIMITS.request) : undefined;
      return { goal: line, requests: [line], request, newTask: stale ? true : undefined, isRequest: true };
    }
    // Some tools fire the prompt hook twice for one message (and Cursor also runs Claude Code's hooks):
    // the same words again within a minute are that one message; later they are a new request.
    if (live.requests.at(-1) === line && live.requestAt !== null && ctx.now - live.requestAt < DUPLICATE_MS) return null;
    return { requests: [...live.requests, line].slice(-LIMITS.requests), isRequest: true };
  }

  if (!live) return null;

  if (event.kind === "edit") {
    const rels = (Array.isArray(event.files) ? event.files : [])
      .filter((f): f is string => typeof f === "string" && f.length > 0)
      .map((f) => relative(ctx.dir, resolve(ctx.dir, f)))
      .filter((r) => r && !r.startsWith("..") && !isAbsolute(r))
      .map((r) => r.replace(/\\/g, "/"));
    if (!rels.length) return null;
    const files = [...live.files.filter((f) => !rels.includes(f)), ...new Set(rels)].slice(-LIMITS.files);
    return { files };
  }

  const reply = oneLine(String(event.reply ?? ""));
  if (!reply) return null;
  // The agent's own "now" is better than its last chat message: keep it when it checkpointed after the request.
  const agentIsCurrent = live.agentAt !== null && (live.requestAt === null || live.agentAt >= live.requestAt);
  if (agentIsCurrent) return null;
  return { now: keep(REPLY_PREFIX + reply, LIMITS.now) };
}
