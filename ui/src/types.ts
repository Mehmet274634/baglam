// Mirrors the JSON the panel API returns (src/store.ts). Kept separate so the browser build has no Node types.

export type Kind = "decision" | "convention" | "preference" | "fact" | "warning";
export const KINDS: Kind[] = ["decision", "convention", "preference", "fact", "warning"];

export type Status = "proposed" | "approved" | "rejected" | "superseded" | "retired";

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
  similarTo: string[];
  reviewState: "unreviewed" | "kept" | null;
}

export type HandoffStatus = "in_progress" | "blocked" | "done";

export interface Handoff {
  project: string;
  branch: string;
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
  /** The user's latest requests, saved by tool hooks. */
  requests?: string[];
  /** Last checkpoint by the agent itself; null when only the tool's hooks saved the task. */
  agentAt?: number | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface GitSnapshot {
  branch: string;
  changed: string[];
  changedCount: number;
  commitsSince: { hash: string; subject: string; at: number }[];
}

export interface PendingEntry extends Entry {
  similar: Entry[];
}

export interface HistoryEvent {
  type: string;
  actor: string;
  at: number;
  detail: string | null;
}

export interface ProjectRow {
  key: string;
  name: string;
  path: string | null;
  archived: boolean;
  approved: number;
  pending: number;
  lastActivity: number | null;
  /** Present on /api/projects. */
  autonomous?: boolean;
  task?: Handoff | null;
}

export interface TrustRule {
  id: string;
  projectId: string | null;
  agent: string | null;
  kind: Kind | null;
  createdAt: number;
}

export interface Tool {
  id: string;
  label: string;
  registered: boolean;
}

export interface Overview {
  user: string;
  projects: ProjectRow[];
  pendingTotal: number;
  tools: Tool[];
}

export interface SecretFinding {
  type: string;
  masked: string;
}

export interface EntryPatch {
  title?: string;
  body?: string;
  rationale?: string;
  kind?: Kind;
}

/** Agent ids `baglam setup` writes; offered as choices for trust rules. */
export const KNOWN_AGENTS = ["claude-code", "codex", "antigravity", "gemini-cli", "cursor", "windsurf", "vscode"];
