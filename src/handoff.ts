import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { describeFindings, scanEntryFields } from "./guards.js";

/** Live, per (project, branch) note of the task in progress, so another agent can continue it. */

export type HandoffStatus = "in_progress" | "blocked" | "done";
export const HANDOFF_STATUSES: HandoffStatus[] = ["in_progress", "blocked", "done"];

export interface Handoff {
  project: string;
  branch: string;
  /** Folder the last checkpoint came from (feeds the git snapshot for the panel and CLI). */
  dir: string | null;
  taskId: string;
  goal: string;
  status: HandoffStatus;
  done: string[];
  now: string | null;
  next: string[];
  files: string[];
  blockers: string | null;
  notes: string | null;
  agent: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface CheckpointInput {
  project: string;
  branch: string;
  dir?: string;
  agent: string;
  goal?: string;
  status?: HandoffStatus;
  done?: string[];
  doneAdd?: string[];
  now?: string;
  next?: string[];
  files?: string[];
  blockers?: string;
  notes?: string;
  /** Start a new task even though one is in progress (the old one goes to history). */
  newTask?: boolean;
}

export const LIMITS = {
  goal: 300,
  item: 300,
  done: 30,
  next: 20,
  files: 50,
  now: 1000,
  blockers: 1000,
  notes: 2000,
  history: 50,
  coalesceMs: 60_000,
} as const;

const DAY = 86_400_000;

export function handoffTtlDays(): number {
  const n = Number(process.env.BAGLAM_HANDOFF_TTL_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

const text = (v: string | undefined, max: number): string | undefined => {
  if (v === undefined) return undefined;
  const t = String(v).trim();
  return t.slice(0, max);
};

const list = (v: string[] | undefined, count: number): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new Error("lists must be arrays of text");
  return v
    .filter((x) => typeof x === "string")
    .map((x) => x.trim().slice(0, LIMITS.item))
    .filter(Boolean)
    .slice(0, count);
};

/** Trim, cap and check a checkpoint before it touches the database. */
export function validateCheckpoint(i: CheckpointInput): CheckpointInput {
  if (i.status !== undefined && !HANDOFF_STATUSES.includes(i.status)) {
    throw new Error(`status must be one of: ${HANDOFF_STATUSES.join(", ")}`);
  }
  return {
    ...i,
    goal: text(i.goal, LIMITS.goal) || undefined,
    now: text(i.now, LIMITS.now),
    blockers: text(i.blockers, LIMITS.blockers),
    notes: text(i.notes, LIMITS.notes),
    done: list(i.done, LIMITS.done),
    doneAdd: list(i.doneAdd, LIMITS.done),
    next: list(i.next, LIMITS.next),
    files: list(i.files, LIMITS.files),
  };
}

type Row = Record<string, SQLInputValue>;

function fromRow(r: Row): Handoff {
  const d = JSON.parse(r.data as string) as Pick<Handoff, "goal" | "status" | "done" | "now" | "next" | "files" | "blockers" | "notes">;
  return {
    project: r.project as string,
    branch: r.branch as string,
    dir: (r.dir as string | null) ?? null,
    taskId: r.task_id as string,
    ...d,
    agent: r.agent as string,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at ?? r.at),
    expiresAt: Number(r.expires_at ?? 0),
  };
}

const payload = (h: Handoff) =>
  JSON.stringify({ goal: h.goal, status: h.status, done: h.done, now: h.now, next: h.next, files: h.files, blockers: h.blockers, notes: h.notes });

/** Storage for handoffs; used through ContextStore. */
export class HandoffRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: () => number,
    private readonly transaction: (fn: () => void) => void,
  ) {}

  get(project: string, branch: string): Handoff | undefined {
    const r = this.db
      .prepare("SELECT * FROM handoffs WHERE project = ? AND branch = ? AND expires_at > ?")
      .get(project, branch, this.clock()) as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  list(project?: string): Handoff[] {
    const rows = this.db
      .prepare("SELECT * FROM handoffs WHERE (:p IS NULL OR project = :p) AND expires_at > :now ORDER BY updated_at DESC")
      .all({ p: project ?? null, now: this.clock() }) as Row[];
    return rows.map(fromRow);
  }

  history(project: string, branch: string, limit = 20): (Handoff & { replaced: boolean })[] {
    const rows = this.db
      .prepare("SELECT * FROM handoff_history WHERE project = ? AND branch = ? ORDER BY seq DESC LIMIT ?")
      .all(project, branch, limit) as Row[];
    return rows.map((r) => ({ ...fromRow({ ...r, created_at: r.at, updated_at: r.at }), replaced: Number(r.replaced) === 1 }));
  }

  checkpoint(raw: CheckpointInput): Handoff {
    const i = validateCheckpoint(raw);
    const findings = scanEntryFields({
      title: i.goal ?? "",
      body: [i.now, i.blockers, i.notes].filter(Boolean).join("\n"),
      tags: [...(i.done ?? []), ...(i.doneAdd ?? []), ...(i.next ?? []), ...(i.files ?? [])],
    });
    if (findings.length) {
      throw new Error(`Not saved: it looks like a secret (${describeFindings(findings)}). Remove it and checkpoint again.`);
    }

    const now = this.clock();
    const existing = this.get(i.project, i.branch);
    const startsNew = !existing || existing.status === "done" || i.newTask === true;
    if (startsNew && !i.goal) throw new Error("goal is required to start a task (what are you working on?)");

    const base: Handoff = startsNew
      ? {
          project: i.project, branch: i.branch, dir: i.dir ?? existing?.dir ?? null,
          taskId: `t${randomBytes(6).toString("hex")}`, goal: i.goal!, status: "in_progress",
          done: [], now: null, next: [], files: [], blockers: null, notes: null,
          agent: i.agent, createdAt: now, updatedAt: now, expiresAt: 0,
        }
      : existing!;

    const done = [...(i.done ?? base.done), ...(i.doneAdd ?? [])].slice(-LIMITS.done);
    const next: Handoff = {
      ...base,
      dir: i.dir ?? base.dir,
      goal: i.goal ?? base.goal,
      status: i.status ?? (startsNew ? "in_progress" : base.status),
      done,
      now: i.now ?? base.now,
      next: i.next ?? base.next,
      files: i.files ?? base.files,
      blockers: i.blockers ?? base.blockers,
      notes: i.notes ?? base.notes,
      agent: i.agent,
      updatedAt: now,
      expiresAt: now + handoffTtlDays() * DAY,
    };

    this.transaction(() => {
      if (startsNew && existing && existing.status !== "done") this.addHistory(existing, true);
      this.db
        .prepare(
          `INSERT INTO handoffs (project, branch, dir, task_id, data, agent, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project, branch) DO UPDATE SET dir = excluded.dir, task_id = excluded.task_id, data = excluded.data,
             agent = excluded.agent, created_at = excluded.created_at, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
        )
        .run(next.project, next.branch, next.dir, next.taskId, payload(next), next.agent, next.createdAt, next.updatedAt, next.expiresAt);
      this.addHistory(next, false);
    });
    return next;
  }

  /** Every checkpoint is saved at once; only history snapshots by the same agent within 60 s are merged. */
  private addHistory(h: Handoff, replaced: boolean): void {
    const last = this.db
      .prepare("SELECT seq, agent, task_id, at, replaced FROM handoff_history WHERE project = ? AND branch = ? ORDER BY seq DESC LIMIT 1")
      .get(h.project, h.branch) as Row | undefined;
    const merge =
      !replaced &&
      last &&
      Number(last.replaced) === 0 &&
      last.agent === h.agent &&
      last.task_id === h.taskId &&
      h.updatedAt - Number(last.at) < LIMITS.coalesceMs;
    if (merge) {
      this.db.prepare("UPDATE handoff_history SET data = ?, dir = ? WHERE seq = ?").run(payload(h), h.dir, last!.seq as number);
    } else {
      this.db
        .prepare("INSERT INTO handoff_history (project, branch, dir, task_id, data, agent, at, replaced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(h.project, h.branch, h.dir, h.taskId, payload(h), h.agent, replaced ? this.clock() : h.updatedAt, replaced ? 1 : 0);
    }
    this.db
      .prepare(
        `DELETE FROM handoff_history WHERE project = ? AND branch = ? AND seq NOT IN
           (SELECT seq FROM handoff_history WHERE project = ? AND branch = ? ORDER BY seq DESC LIMIT ?)`,
      )
      .run(h.project, h.branch, h.project, h.branch, LIMITS.history);
  }

  clear(project: string, branch: string, by: string): boolean {
    if (!this.get(project, branch)) return false;
    this.checkpoint({ project, branch, agent: by, status: "done" });
    return true;
  }

  rekey(from: string, to: string): void {
    this.db.prepare("UPDATE OR REPLACE handoffs SET project = ? WHERE project = ?").run(to, from);
    this.db.prepare("UPDATE handoff_history SET project = ? WHERE project = ?").run(to, from);
  }
}
