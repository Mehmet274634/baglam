import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate.js";

export const KINDS = ["decision", "convention", "preference", "fact", "warning"] as const;
export type Kind = (typeof KINDS)[number];
export type Status = "proposed" | "approved" | "rejected" | "superseded";

export interface Entry {
  id: string;
  project: string;
  kind: Kind;
  title: string;
  body: string;
  rationale: string | null;
  tags: string[];
  audience: string[];
  status: Status;
  sourceAgent: string;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  decisionNote: string | null;
  expiresAt: number | null;
  supersedes: string | null;
  supersededBy: string | null;
  editedAt: number | null;
  autoApproved: boolean;
}

export interface NewEntry {
  project: string;
  kind: Kind;
  title: string;
  body: string;
  rationale?: string;
  tags?: string[];
  /** Agent names allowed to see this entry. Omitted or empty means everyone ("*"). */
  audience?: string[];
  ttlDays?: number;
  supersedes?: string;
}

export interface ProjectSummary {
  project: string;
  approved: number;
  pending: number;
}

const DAY_MS = 86_400_000;
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** SQL fragment: entry `e` is visible to the agent bound at `:agent`, at time `:now`. */
const VISIBLE = `
  e.project = :project
  AND e.status = 'approved'
  AND (e.expires_at IS NULL OR e.expires_at > :now)
  AND EXISTS (SELECT 1 FROM json_each(e.audience) WHERE value IN ('*', :agent))
`;

type Row = Record<string, SQLInputValue>;

function newId(): string {
  const bytes = randomBytes(8);
  let id = "c";
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

function cleanList(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))];
}

function requireText(value: string | undefined, field: string, max: number): string {
  const v = (value ?? "").trim();
  if (!v) throw new Error(`${field} is required`);
  if (v.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return v;
}

/** Turn free text into a safe FTS5 query: every word must match, no operators. */
export function toFtsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}_]+/gu);
  if (!words?.length) return null;
  return words.map((w) => `"${w}"`).join(" ");
}

function toEntry(r: Row): Entry {
  return {
    id: r.id as string,
    project: r.project as string,
    kind: r.kind as Kind,
    title: r.title as string,
    body: r.body as string,
    rationale: (r.rationale as string | null) ?? null,
    tags: JSON.parse(r.tags as string),
    audience: JSON.parse(r.audience as string),
    status: r.status as Status,
    sourceAgent: r.source_agent as string,
    createdAt: Number(r.created_at),
    decidedAt: r.decided_at == null ? null : Number(r.decided_at),
    decidedBy: (r.decided_by as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    expiresAt: r.expires_at == null ? null : Number(r.expires_at),
    supersedes: (r.supersedes as string | null) ?? null,
    supersededBy: (r.superseded_by as string | null) ?? null,
    editedAt: r.edited_at == null ? null : Number(r.edited_at),
    autoApproved: Number(r.auto_approved ?? 0) === 1,
  };
}

export class ContextStore {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly clock: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    migrate(this.db, path);
  }

  close(): void {
    this.db.close();
  }

  /** An agent proposes an entry. It stays invisible until a human approves it. */
  propose(input: NewEntry & { sourceAgent: string }): Entry {
    return this.insert(input, requireText(input.sourceAgent, "sourceAgent", 100), "proposed");
  }

  /** A human adds an entry directly; it is approved at once. */
  addApproved(input: NewEntry, by: string): Entry {
    const e = this.insert(input, by, "proposed");
    return this.approve(e.id, by);
  }

  get(id: string): Entry | undefined {
    const r = this.db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as Row | undefined;
    return r ? toEntry(r) : undefined;
  }

  approve(id: string, by: string, note?: string): Entry {
    const e = this.mustBePending(id);
    const now = this.clock();
    this.transaction(() => {
      this.db
        .prepare("UPDATE entries SET status='approved', decided_at=?, decided_by=?, decision_note=? WHERE id=?")
        .run(now, by, note ?? null, id);
      if (e.supersedes) {
        this.db
          .prepare("UPDATE entries SET status='superseded', superseded_by=? WHERE id=? AND status='approved'")
          .run(id, e.supersedes);
      }
    });
    return this.get(id)!;
  }

  reject(id: string, by: string, note?: string): Entry {
    this.mustBePending(id);
    this.db
      .prepare("UPDATE entries SET status='rejected', decided_at=?, decided_by=?, decision_note=? WHERE id=?")
      .run(this.clock(), by, note ?? null, id);
    return this.get(id)!;
  }

  /** Approved, unexpired entries this agent may see, newest first. */
  visible(project: string, agent: string, opts: { kind?: Kind; limit?: number } = {}): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM entries e WHERE ${VISIBLE}
         AND (:kind IS NULL OR e.kind = :kind)
         ORDER BY e.decided_at DESC, e.rowid DESC LIMIT :limit`,
      )
      .all({ project, agent, now: this.clock(), kind: opts.kind ?? null, limit: opts.limit ?? 200 }) as Row[];
    return rows.map(toEntry);
  }

  search(project: string, agent: string, text: string, opts: { kind?: Kind; limit?: number } = {}): Entry[] {
    const match = toFtsQuery(text);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT e.* FROM entries_fts f JOIN entries e ON e.rowid = f.rowid
         WHERE entries_fts MATCH :match AND ${VISIBLE}
         AND (:kind IS NULL OR e.kind = :kind)
         ORDER BY bm25(entries_fts) LIMIT :limit`,
      )
      .all({ match, project, agent, now: this.clock(), kind: opts.kind ?? null, limit: opts.limit ?? 20 }) as Row[];
    return rows.map(toEntry);
  }

  /** Pending proposals; all projects when `project` is omitted. Oldest first. */
  pending(project?: string): Entry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM entries WHERE status='proposed' AND (:project IS NULL OR project = :project)
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all({ project: project ?? null }) as Row[];
    return rows.map(toEntry);
  }

  /** Every entry for a project regardless of status, newest first (for humans). */
  all(project: string): Entry[] {
    const rows = this.db
      .prepare("SELECT * FROM entries WHERE project = ? ORDER BY created_at DESC, rowid DESC")
      .all(project) as Row[];
    return rows.map(toEntry);
  }

  projects(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT project,
                sum(status='approved' AND (expires_at IS NULL OR expires_at > :now)) AS approved,
                sum(status='proposed') AS pending
         FROM entries GROUP BY project ORDER BY project`,
      )
      .all({ now: this.clock() }) as Row[];
    return rows.map((r) => ({ project: r.project as string, approved: Number(r.approved), pending: Number(r.pending) }));
  }

  private insert(input: NewEntry, sourceAgent: string, status: Status): Entry {
    if (!KINDS.includes(input.kind)) throw new Error(`kind must be one of: ${KINDS.join(", ")}`);
    const project = requireText(input.project, "project", 1000);
    const title = requireText(input.title, "title", 200);
    const body = requireText(input.body, "body", 8000);
    const rationale = input.rationale?.trim() ? requireText(input.rationale, "rationale", 4000) : null;
    if (input.ttlDays !== undefined && !(input.ttlDays > 0)) throw new Error("ttlDays must be positive");
    if (input.supersedes) {
      const target = this.get(input.supersedes);
      if (!target) throw new Error(`supersedes: unknown entry ${input.supersedes}`);
      if (target.project !== project) throw new Error("supersedes: entry belongs to a different project");
    }
    const audience = cleanList(input.audience);
    const now = this.clock();
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO entries (id, project, kind, title, body, rationale, tags, audience, status,
                              source_agent, created_at, expires_at, supersedes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, project, input.kind, title, body, rationale,
        JSON.stringify(cleanList(input.tags)),
        JSON.stringify(audience.length ? audience : ["*"]),
        status, sourceAgent, now,
        input.ttlDays ? now + Math.round(input.ttlDays * DAY_MS) : null,
        input.supersedes ?? null,
      );
    return this.get(id)!;
  }

  private mustBePending(id: string): Entry {
    const e = this.get(id);
    if (!e) throw new Error(`unknown entry ${id}`);
    if (e.status !== "proposed") throw new Error(`entry ${id} is not pending (status: ${e.status})`);
    return e;
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
