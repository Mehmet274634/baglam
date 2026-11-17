import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KINDS, type ContextStore } from "./store.js";
import { FRAMING, formatBrief, formatEntry } from "./format.js";
import { resolveProjectFor, type Resolution } from "./resolve.js";
import type { ProjectRef } from "./project.js";

export const VERSION = "0.2.0";

export interface ServerOptions {
  /** The server process's working directory (last-resort project guess). */
  cwd: string;
  /** BAGLAM_PROJECT, when set. */
  envProject?: string;
  /** Agent name; when omitted, the MCP client's own name is used. */
  agent?: string;
}

const kindSchema = z.enum(KINDS);
const projectPathSchema = z
  .string()
  .optional()
  .describe("Absolute path of your workspace folder. Pass it whenever you know it.");

function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function createServer(store: ContextStore, opts: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "baglam", version: VERSION },
    {
      instructions:
        "Bağlam shares approved project context between AI agents. Call context_brief at the start of a task. " +
        "Call context_propose when you settle a decision, learn a convention or user preference, or hit a pitfall " +
        "other agents should know about. Proposals reach other agents only after a human approves them. " +
        "Always pass project_path (your workspace folder) when you know it.",
    },
  );

  const agentName = (): string =>
    opts.agent ?? server.server.getClientVersion()?.name?.trim() ?? "unknown-agent";

  // Client roots, fetched lazily and dropped whenever the client says they changed.
  let rootsCache: string[] | undefined;
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    rootsCache = undefined;
  });
  async function clientRoots(): Promise<string[]> {
    if (rootsCache) return rootsCache;
    if (!server.server.getClientCapabilities()?.roots) return [];
    try {
      rootsCache = (await server.server.listRoots()).roots.map((r) => r.uri);
    } catch {
      rootsCache = [];
    }
    return rootsCache;
  }

  async function resolve(projectPath: string | undefined): Promise<Resolution> {
    const r = resolveProjectFor({ projectPath, env: opts.envProject, roots: await clientRoots(), cwd: opts.cwd });
    if (r.ok) store.touchProject(r.project);
    return r;
  }

  const label = (p: ProjectRef) => `${p.name} (${p.dir})`;

  const guard =
    <A>(fn: (args: A) => Promise<string>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return ok(await fn(args));
      } catch (err) {
        return fail(err);
      }
    };

  function briefFor(project: ProjectRef, agent: string): string {
    return formatBrief(label(project), agent, store.visible(project.key, agent), store.pending(project.key).length);
  }

  server.registerTool(
    "context_brief",
    {
      title: "Get shared project context",
      description:
        "Returns every approved, active record shared with you for this project: decisions, conventions, " +
        "preferences, facts and warnings. Call this once at the start of a task.",
      inputSchema: { project_path: projectPathSchema },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ project_path }) => {
      const agent = agentName();
      const r = await resolve(project_path);
      if (r.ok) return briefFor(r.project, agent);
      const known = r.candidates.filter((c) => c.initialized);
      if (r.reason === "ambiguous" && known.length) {
        return [r.message, ...known.map((p) => briefFor(p, agent))].join("\n\n---\n\n");
      }
      return r.message;
    }),
  );

  server.registerTool(
    "context_search",
    {
      title: "Search shared project context",
      description: "Full-text search over approved records shared with you. All words must match.",
      inputSchema: {
        query: z.string().min(1).describe("Words to look for"),
        kind: kindSchema.optional().describe("Only return this kind of record"),
        limit: z.number().int().min(1).max(50).optional(),
        project_path: projectPathSchema,
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ query, kind, limit, project_path }) => {
      const r = await resolve(project_path);
      if (!r.ok) return r.message;
      const hits = store.search(r.project.key, agentName(), query, { kind, limit });
      if (!hits.length) return `No matching approved records for "${query}".`;
      return [FRAMING, ...hits.map((e) => formatEntry(e))].join("\n\n");
    }),
  );

  server.registerTool(
    "context_get",
    {
      title: "Get one shared record",
      description: "Returns one record by id, including what it replaces or was replaced by.",
      inputSchema: { id: z.string().min(1), project_path: projectPathSchema },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ id, project_path }) => {
      const r = await resolve(project_path);
      if (!r.ok) return r.message;
      const e = store.get(id);
      const agent = agentName();
      const visibleToAgent =
        e &&
        e.project === r.project.key &&
        (e.audience.includes("*") || e.audience.includes(agent)) &&
        e.status !== "proposed" &&
        e.status !== "rejected";
      if (!visibleToAgent) throw new Error(`no record ${id} is visible to ${agent} in this project`);
      return `${FRAMING}\n\n${formatEntry(e, { full: true })}`;
    }),
  );

  server.registerTool(
    "context_propose",
    {
      title: "Propose shared context",
      description:
        "Propose a record for other agents on this project. It is stored as pending and becomes visible " +
        "only after the project owner approves it. Write it so an agent with no other context can act on it. " +
        "Do not include secrets, credentials or personal data.",
      inputSchema: {
        kind: kindSchema.describe(
          "decision: a choice that was made · convention: how things are done here · preference: what the user wants · " +
            "fact: something true about the project · warning: a pitfall or known problem",
        ),
        title: z.string().min(1).max(200).describe("One-line summary"),
        body: z.string().min(1).max(8000).describe("The content itself, self-contained"),
        rationale: z.string().max(4000).optional().describe("Why; evidence or reasoning"),
        tags: z.array(z.string().max(50)).max(20).optional(),
        audience: z
          .array(z.string().max(100))
          .max(50)
          .optional()
          .describe("Agent names that may see this; omit to share with all agents"),
        ttl_days: z.number().positive().max(3650).optional().describe("Forget after this many days"),
        supersedes: z.string().optional().describe("Id of an existing record this one replaces"),
        project_path: projectPathSchema,
      },
    },
    guard(async ({ ttl_days, project_path, ...rest }) => {
      const r = await resolve(project_path);
      if (!r.ok) throw new Error(r.message);
      const e = store.propose({ ...rest, ttlDays: ttl_days, project: r.project.key, sourceAgent: agentName() });
      return `Proposed ${e.id} ("${e.title}") for ${label(r.project)}. It is pending human approval and is not yet visible to other agents.`;
    }),
  );

  return server;
}
