import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KINDS, type ContextStore } from "./store.js";
import { FRAMING, briefBudgetFromEnv, formatBrief, formatEntry } from "./format.js";
import { floodLimitFromEnv, submitProposal } from "./policy.js";
import { describeFindings } from "./guards.js";
import { resolveProjectFor, type Resolution } from "./resolve.js";
import type { ProjectRef } from "./project.js";

export { VERSION } from "./version.js";
import { VERSION } from "./version.js";

/** The brief counts "how many more" up to this many records. */
const COUNT_CAP = 1000;

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
    const total = store.countVisible(project.key, agent, COUNT_CAP);
    return formatBrief({
      project,
      agent,
      // A brief holds a few dozen records at most; fetch the top slice in priority order and count the rest.
      entries: store.visible(project.key, agent, { limit: 150, byPriority: true }),
      total,
      totalCapped: total >= COUNT_CAP,
      budgetTokens: briefBudgetFromEnv(),
      pendingCount: store.pending(project.key).length,
    });
  }

  async function brief(projectPath: string | undefined): Promise<string> {
    const agent = agentName();
    const r = await resolve(projectPath);
    if (r.ok) return briefFor(r.project, agent);
    const known = r.candidates.filter((c) => c.initialized);
    if (r.reason === "ambiguous" && known.length) {
      return [r.message, ...known.map((p) => briefFor(p, agent))].join("\n\n---\n\n");
    }
    return r.message;
  }

  server.registerResource(
    "brief",
    "baglam://brief",
    {
      title: "Shared project context",
      description: "Approved Bağlam records for the current project (same as the context_brief tool).",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: await brief(undefined) }] }),
  );

  server.registerPrompt(
    "baglam_start",
    {
      title: "Start with shared context",
      description: "Load the project's shared Bağlam context before starting work.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Before you start, call the context_brief tool (pass project_path with this workspace's folder) and " +
              "follow the decisions, conventions and warnings it returns. When you settle something other agents " +
              "should know, propose it with context_propose.",
          },
        },
      ],
    }),
  );

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
    guard(({ project_path }) => brief(project_path)),
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
      const outcome = submitProposal(
        store,
        { ...rest, ttlDays: ttl_days, project: r.project.key, sourceAgent: agentName() },
        { agentVerified: opts.agent !== undefined, floodLimit: floodLimitFromEnv() },
      );
      switch (outcome.status) {
        case "blocked":
          throw new Error(
            `Not stored: it looks like it contains a secret (${describeFindings(outcome.findings)}). ` +
              "Remove it and propose again.",
          );
        case "refused":
          throw new Error(outcome.reason);
        case "auto-approved":
          return `Saved ${outcome.entry.id} ("${outcome.entry.title}") for ${label(r.project)} and shared with other agents (auto-approved by a trust rule the owner set).`;
        case "pending": {
          const e = outcome.entry;
          const base = `Proposed ${e.id} ("${e.title}") for ${label(r.project)}. It is pending human approval and is not yet visible to other agents.`;
          // Only name records this agent may already read: never other agents' pending proposals
          // or records whose audience leaves it out. The owner sees the full list in review.
          const agent = agentName();
          const shown = outcome.similar.filter(
            (s) =>
              s.status === "approved" &&
              (s.expiresAt === null || s.expiresAt > Date.now()) &&
              (s.audience.includes("*") || s.audience.includes(agent)),
          );
          if (!shown.length) return base;
          const list = shown.map((s) => `${s.id} "${s.title}"`).join(", ");
          return `${base}\nSimilar records already exist: ${list}. If yours replaces one, propose again with supersedes set to its id.`;
        }
      }
    }),
  );

  return server;
}
