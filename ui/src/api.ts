import type { Entry, EntryPatch, HistoryEvent, Kind, Overview, PendingEntry, ProjectRow, Status, TrustRule } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText, data as Record<string, unknown>);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export interface RecordQuery {
  project?: string;
  status?: Status | "active" | "";
  kind?: Kind | "";
  agent?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  overview: () => call<Overview>("GET", "/api/overview"),
  projects: (archived = false) => call<{ items: ProjectRow[] }>("GET", `/api/projects${archived ? "?archived=1" : ""}`).then((r) => r.items),
  pending: (project?: string) => call<{ items: PendingEntry[] }>("GET", `/api/pending${qs({ project })}`).then((r) => r.items),
  approve: (id: string, note?: string) => call<Entry>("POST", `/api/entries/${id}/approve`, { note }),
  reject: (id: string, note?: string) => call<Entry>("POST", `/api/entries/${id}/reject`, { note }),
  edit: (id: string, patch: EntryPatch, opts: { approve?: boolean; force?: boolean } = {}) =>
    call<Entry>("POST", `/api/entries/${id}/edit`, { patch, ...opts }),
  retire: (id: string, note?: string) => call<Entry>("POST", `/api/entries/${id}/retire`, { note }),
  approveAll: (ids: string[]) => call<{ approved: number; skipped: number }>("POST", "/api/approve-all", { ids }),
  records: (q: RecordQuery) =>
    call<{ items: Entry[]; total: number }>("GET", `/api/records${qs({ ...q } as Record<string, string | number | undefined>)}`),
  entry: (id: string) => call<{ entry: PendingEntry; history: HistoryEvent[] }>("GET", `/api/entries/${id}`),
  renameProject: (id: string, name: string) => call("POST", `/api/projects/${id}/rename`, { name }),
  archiveProject: (id: string) => call("POST", `/api/projects/${id}/archive`, {}),
  restoreProject: (id: string) => call("POST", `/api/projects/${id}/restore`, {}),
  deleteProject: (key: string, confirm: string) => call<{ deleted: number }>("DELETE", `/api/projects/${encodeURIComponent(key)}`, { confirm }),
  trust: (project?: string) => call<{ items: TrustRule[] }>("GET", `/api/trust${qs({ project })}`).then((r) => r.items),
  addTrust: (rule: { projectId: string | null; agent?: string; kind?: Kind }) => call<TrustRule>("POST", "/api/trust", rule),
  removeTrust: (id: string) => call("DELETE", `/api/trust/${id}`),
};

export type Api = typeof api;
