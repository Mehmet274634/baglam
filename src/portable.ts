import type { ContextStore, Entry, EventType, Kind } from "./store.js";
import { KINDS } from "./store.js";
import { scanEntryFields, type SecretFinding } from "./guards.js";
import { day } from "./format.js";

export const EXPORT_FORMAT = "baglam/1";

export interface ExportedEvent {
  entryId: string;
  type: EventType;
  actor: string;
  at: number;
  detail: string | null;
}

export interface BaglamExport {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  projects: { key: string; name: string }[];
  entries: Entry[];
  events: ExportedEvent[];
}

/** Every record (all statuses) and its history, for one project or all of them. */
export function exportJson(store: ContextStore, opts: { project?: string } = {}): BaglamExport {
  const projects = store
    .listProjects({ includeArchived: true })
    .filter((p) => !opts.project || p.key === opts.project)
    .map((p) => ({ key: p.key, name: p.name }));
  const entries: Entry[] = [];
  for (const p of projects) {
    for (let offset = 0; ; offset += 500) {
      const page = store.query({ project: p.key, limit: 500, offset });
      entries.push(...page.items);
      if (entries.length >= page.total || !page.items.length) break;
    }
  }
  entries.sort((a, b) => a.createdAt - b.createdAt);
  const events = store.eventsOf(entries.map((e) => e.id)).map(({ project: _p, ...ev }) => ev);
  return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), projects, entries, events };
}

const KIND_ORDER: Kind[] = ["warning", "decision", "convention", "preference", "fact"];
const HEADINGS: Record<Kind, string> = {
  warning: "Warnings",
  decision: "Decisions",
  convention: "Conventions",
  preference: "Preferences",
  fact: "Facts",
};

/** Body lines become a blockquote so headings or lists inside a record cannot break the document. */
const quote = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/** A readable CONTEXT.md of the project's active records. */
export function exportMarkdown(store: ContextStore, project: string): string {
  const name = store.listProjects({ includeArchived: true }).find((p) => p.key === project)?.name ?? project;
  const active = store.query({ project, status: "active", limit: 500 }).items;
  const out = [`# Shared project context: ${name}`, "", `_Exported from Bağlam on ${day(Date.now())}. ${active.length} active record(s)._`];
  for (const kind of KIND_ORDER) {
    const group = active.filter((e) => e.kind === kind);
    if (!group.length) continue;
    out.push("", `## ${HEADINGS[kind]}`);
    for (const e of group) {
      out.push("", `### ${e.title.replace(/\r?\n/g, " ")}`, "", quote(e.body));
      if (e.rationale) out.push("", `**Why:** ${e.rationale.replace(/\r?\n/g, " ")}`);
      const meta = [`\`${e.id}\``, `from ${e.sourceAgent}`];
      if (e.decidedBy) meta.push(e.autoApproved ? "auto-approved" : `approved by ${e.decidedBy}`);
      if (e.tags.length) meta.push(e.tags.map((t) => `#${t}`).join(" "));
      out.push("", `<sub>${meta.join(" · ")}</sub>`);
    }
  }
  return out.join("\n") + "\n";
}

export interface ImportResult {
  imported: number;
  skipped: number;
  blocked: { id: string; findings: SecretFinding[] }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Coerce one exported record; null when required fields are missing or invalid. */
function toEntry(raw: unknown): Entry | null {
  if (!isObj(raw)) return null;
  const s = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  const n = (k: string) => (typeof raw[k] === "number" && Number.isFinite(raw[k]) ? (raw[k] as number) : null);
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const id = s("id"), project = s("project"), kind = s("kind"), title = s("title"), body = s("body");
  const status = s("status"), sourceAgent = s("sourceAgent"), createdAt = n("createdAt");
  if (!id || !/^c[a-z0-9]{4,20}$/.test(id) || !project || !title || !body || !status || !sourceAgent || createdAt === null) return null;
  if (!KINDS.includes(kind as Kind)) return null;
  const audience = list("audience");
  return {
    id, project, kind: kind as Kind, title, body, rationale: s("rationale"), tags: list("tags"),
    audience: audience.length ? audience : ["*"], status: status as Entry["status"], sourceAgent, createdAt,
    decidedAt: n("decidedAt"), decidedBy: s("decidedBy"), decisionNote: s("decisionNote"), expiresAt: n("expiresAt"),
    supersedes: s("supersedes"), supersededBy: s("supersededBy"), editedAt: n("editedAt"),
    autoApproved: raw.autoApproved === true, similarTo: list("similarTo"),
  };
}

/** Merge an export into this database by record id. Existing ids are never overwritten. */
export function importJson(store: ContextStore, data: unknown, opts: { force?: boolean; by: string }): ImportResult {
  if (!isObj(data) || data.format !== EXPORT_FORMAT || !Array.isArray(data.entries)) {
    throw new Error(`not a Bağlam export (expected "format": "${EXPORT_FORMAT}")`);
  }
  const events = Array.isArray(data.events) ? data.events.filter(isObj) : [];
  const result: ImportResult = { imported: 0, skipped: 0, blocked: [] };
  if (Array.isArray(data.projects)) {
    for (const p of data.projects.filter(isObj)) {
      if (typeof p.key === "string" && typeof p.name === "string") store.ensureProject(p.key, p.name);
    }
  }
  for (const raw of data.entries) {
    const e = toEntry(raw);
    if (!e) {
      result.skipped++;
      continue;
    }
    const findings = scanEntryFields(e);
    if (findings.length && !opts.force) {
      result.blocked.push({ id: e.id, findings });
      continue;
    }
    const history = events
      .filter((ev) => ev.entryId === e.id && typeof ev.type === "string" && typeof ev.actor === "string" && typeof ev.at === "number")
      .map((ev) => ({ type: ev.type as EventType, actor: ev.actor as string, at: ev.at as number, detail: typeof ev.detail === "string" ? ev.detail : null }));
    try {
      if (store.importEntry(e, history)) result.imported++;
      else result.skipped++;
    } catch {
      result.skipped++;
    }
  }
  return result;
}
