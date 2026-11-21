import { KINDS, type Entry, type EntryPatch, type Kind, type Status } from "../store.js";
import { scanEntryFields } from "../guards.js";
import { detectClients } from "../setup.js";
import { HOOK_INSTALLERS } from "../clients/hooks.js";
import type { HookClient } from "../hooks/normalize.js";
import { HttpError, route, type Route } from "./http.js";
import { existsSync } from "node:fs";
import { gitSnapshot } from "../git.js";
import { resumePrompt } from "../format.js";
import type { PanelContext } from "./server.js";

type Body = Record<string, unknown>;

const STATUSES: (Status | "active")[] = ["active", "proposed", "approved", "rejected", "superseded", "retired"];

function obj(body: unknown): Body {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};
}

function str(v: unknown, field: string, opts: { optional?: boolean } = {}): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    throw new HttpError(400, `${field} is required`);
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  return v;
}

function strList(v: unknown, field: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(400, `${field} must be a list of text`);
  return v as string[];
}

function kindOf(v: unknown): Kind | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (!KINDS.includes(v as Kind)) throw new HttpError(400, `kind must be one of: ${KINDS.join(", ")}`);
  return v as Kind;
}

function intParam(q: URLSearchParams, name: string, fallback: number, max: number): number {
  const raw = q.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${name} must be a whole number`);
  return Math.min(n, max);
}

function patchOf(v: unknown): EntryPatch {
  const p = obj(v);
  return {
    title: str(p.title, "title", { optional: true }),
    body: str(p.body, "body", { optional: true }),
    rationale: p.rationale === undefined ? undefined : (str(p.rationale, "rationale", { optional: true }) ?? ""),
    tags: strList(p.tags, "tags"),
    audience: strList(p.audience, "audience"),
    kind: kindOf(p.kind),
  };
}

/** The panel's JSON API. Every route runs behind the session cookie and Host/Origin checks. */
export function panelApi(ctx: PanelContext): Route[] {
  const { store, user, host } = ctx;
  const withSimilar = (e: Entry) => ({
    ...e,
    similar: e.similarTo.map((id) => store.get(id)).filter((x): x is Entry => !!x),
  });

  return [
    route("GET", "/api/overview", () => {
      const projects = store.listProjects();
      const seen = store.hookSeen();
      return {
        user,
        projects,
        pendingTotal: projects.reduce((n, p) => n + p.pending, 0),
        tools: detectClients(host).map((c) => {
          const hooks = HOOK_INSTALLERS[c.id as HookClient];
          const hs = hooks?.status(host);
          return {
            id: c.id,
            label: c.label,
            registered: c.status(host).registered,
            autoSave: hs ? { installed: hs.installed, ...(hs.problem ? { problem: hs.problem } : {}), lastSeen: seen[c.id]?.at ?? null } : null,
          };
        }),
      };
    }),

    route("GET", "/api/projects", ({ query }) => ({
      items: store.listProjects({ includeArchived: query.get("archived") === "1" }).map((p) => ({
        ...p,
        autonomous: store.isAutonomous(p.key),
        task: store.listHandoffs(p.key).find((h) => h.status !== "done") ?? null,
      })),
    })),

    route("GET", "/api/pending", ({ query }) => ({
      items: store.pending(query.get("project") || undefined).map(withSimilar),
    })),

    route("POST", "/api/entries/:id/approve", ({ params, body }) =>
      store.approve(params.id, user, str(obj(body).note, "note", { optional: true })),
    ),

    route("POST", "/api/entries/:id/reject", ({ params, body }) =>
      store.reject(params.id, user, str(obj(body).note, "note", { optional: true })),
    ),

    route("POST", "/api/entries/:id/edit", ({ params, body }) => {
      const b = obj(body);
      const patch = patchOf(b.patch);
      const current = store.get(params.id);
      if (!current) throw new HttpError(404, `unknown entry ${params.id}`);
      const merged = {
        title: patch.title ?? current.title,
        body: patch.body ?? current.body,
        rationale: patch.rationale ?? current.rationale,
        tags: patch.tags ?? current.tags,
        audience: patch.audience ?? current.audience,
      };
      const secrets = scanEntryFields(merged);
      if (secrets.length && b.force !== true) {
        throw new HttpError(409, "This looks like it contains a secret. Confirm to save it anyway.", { secrets });
      }
      return b.approve === true && current.status === "proposed"
        ? store.editAndApprove(params.id, patch, user)
        : store.edit(params.id, patch, user);
    }),

    route("POST", "/api/entries/:id/retire", ({ params, body }) =>
      store.retire(params.id, user, str(obj(body).note, "note", { optional: true })),
    ),

    // Approves exactly the proposals the owner was shown; anything that arrived since stays pending.
    route("POST", "/api/approve-all", ({ body }) => {
      const ids = strList(obj(body).ids, "ids");
      if (!ids?.length) throw new HttpError(400, "ids is required: the proposals that were shown");
      const r = store.approveMany(ids, user);
      return { approved: r.approved.length, skipped: r.skipped.length };
    }),

    route("GET", "/api/entries/:id", ({ params }) => {
      const entry = store.get(params.id);
      if (!entry) throw new HttpError(404, `unknown entry ${params.id}`);
      return { entry: withSimilar(entry), history: store.history(params.id) };
    }),

    route("GET", "/api/records", ({ query }) => {
      const status = query.get("status") || undefined;
      if (status && !STATUSES.includes(status as Status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(", ")}`);
      return store.query({
        project: query.get("project") || undefined,
        status: status as Status | "active" | undefined,
        kind: kindOf(query.get("kind")),
        agent: query.get("agent") || undefined,
        text: query.get("q") || undefined,
        limit: intParam(query, "limit", 50, 200),
        offset: intParam(query, "offset", 0, 1_000_000),
      });
    }),

    route("POST", "/api/projects/:id/rename", ({ params, body }) => {
      store.renameProject(params.id, str(obj(body).name, "name")!);
      return { ok: true };
    }),

    route("POST", "/api/projects/:id/archive", ({ params }) => {
      store.archiveProject(params.id, user);
      return { ok: true };
    }),

    route("POST", "/api/projects/:id/restore", ({ params }) => {
      store.restoreProject(params.id, user);
      return { ok: true };
    }),

    route("DELETE", "/api/projects/:key", ({ params, body }) => {
      const project = store.listProjects({ includeArchived: true }).find((p) => p.key === params.key);
      if (!project) throw new HttpError(404, `unknown project ${params.key}`);
      if (obj(body).confirm !== project.name) {
        throw new HttpError(400, `type the project name "${project.name}" to confirm permanent deletion`);
      }
      return { deleted: store.deleteProject(params.key, user) };
    }),

    // ---- Handoffs (work in progress) ----

    route("GET", "/api/handoffs", ({ query }) => ({
      items: store.listHandoffs(query.get("project") || undefined).filter((h) => h.status !== "done"),
    })),

    route("GET", "/api/handoffs/:project/:branch", async ({ params }) => {
      const handoff = store.getHandoff(params.project, params.branch);
      if (!handoff) throw new HttpError(404, `no task in progress on ${params.branch}`);
      const git = handoff.dir && existsSync(handoff.dir) ? await gitSnapshot(handoff.dir, handoff.updatedAt) : null;
      return { handoff, history: store.handoffHistory(params.project, params.branch, 30), git };
    }),

    route("GET", "/api/handoffs/:project/:branch/prompt", async ({ params }) => {
      const handoff = store.getHandoff(params.project, params.branch);
      if (!handoff) throw new HttpError(404, `no task in progress on ${params.branch}`);
      const git = handoff.dir && existsSync(handoff.dir) ? await gitSnapshot(handoff.dir, handoff.updatedAt) : null;
      const projectName = store.listProjects({ includeArchived: true }).find((p) => p.key === params.project)?.name ?? params.project;
      const records = store.query({ project: params.project, status: "active", limit: 50 }).items;
      return { text: resumePrompt({ projectName, dir: handoff.dir, handoff, git, records }) };
    }),

    route("POST", "/api/handoffs/:project/:branch/clear", ({ params }) => {
      if (!store.clearHandoff(params.project, params.branch, user)) throw new HttpError(404, `no task in progress on ${params.branch}`);
      return { ok: true };
    }),

    // ---- Autonomous mode: share now, review afterwards ----

    route("GET", "/api/projects/:key/autonomous", ({ params }) => ({ on: store.isAutonomous(params.key) })),

    route("POST", "/api/projects/:key/autonomous", ({ params, body }) => {
      const on = obj(body).on;
      if (typeof on !== "boolean") throw new HttpError(400, "on must be true or false");
      store.setAutonomous(params.key, on, user);
      return { on };
    }),

    // ---- Automatic saving from tool hooks ----

    route("GET", "/api/projects/:key/capture", ({ params }) => ({ on: store.isAutoCapture(params.key) })),

    route("POST", "/api/projects/:key/capture", ({ params, body }) => {
      const on = obj(body).on;
      if (typeof on !== "boolean") throw new HttpError(400, "on must be true or false");
      store.setAutoCapture(params.key, on, user);
      return { on };
    }),

    route("GET", "/api/review",({ query }) => ({ items: store.unreviewed(query.get("project") || undefined) })),

    route("POST", "/api/review/keep", ({ body }) => {
      const ids = strList(obj(body).ids, "ids");
      if (!ids?.length) throw new HttpError(400, "ids is required");
      return { kept: store.keep(ids, user) };
    }),

    route("POST", "/api/entries/:id/undo", ({ params }) => store.undoAuto(params.id, user)),

    route("GET", "/api/trust", ({ query }) => ({ items: store.listTrustRules(query.get("project") || undefined) })),

    route("POST", "/api/trust", ({ body }) => {
      const b = obj(body);
      const projectId = b.projectId === null ? null : str(b.projectId, "projectId")!;
      return store.addTrustRule({ projectId, agent: str(b.agent, "agent", { optional: true }), kind: kindOf(b.kind) });
    }),

    route("DELETE", "/api/trust/:id", ({ params }) => {
      if (!store.removeTrustRule(params.id)) throw new HttpError(404, `no trust rule ${params.id}`);
      return { ok: true };
    }),
  ];
}
