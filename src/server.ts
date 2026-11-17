import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { KINDS, type ContextStore } from "./store.js";
import { FRAMING, formatBrief, formatEntry } from "./format.js";

export const VERSION = "0.1.0";

export interface ServerOptions {
  /** Normalised project key all tool calls are scoped to. */
  project: string;
  /** Agent name; when omitted, the MCP client's own name is used. */
  agent?: string;
}

const kindSchema = z.enum(KINDS);

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
        "other agents should know about. Proposals reach other agents only after a human approves them.",
    },
  );

  const agentName = (): string =>
    opts.agent ?? server.server.getClientVersion()?.name?.trim() ?? "unknown-agent";

  const guard =
    <A>(fn: (args: A) => string) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return ok(fn(args));
      } catch (err) {
        return fail(err);
      }
    };

  server.registerTool(
    "context_brief",
    {
      title: "Get shared project context",
      description:
        "Returns every approved, active record shared with you for this project: decisions, conventions, " +
        "preferences, facts and warnings. Call this once at the start of a task.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(() => {
      const agent = agentName();
      return formatBrief(opts.project, agent, store.visible(opts.project, agent), store.pending(opts.project).length);
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
      },
      annotations: { readOnlyHint: true },
    },
    guard(({ query, kind, limit }) => {
      const hits = store.search(opts.project, agentName(), query, { kind, limit });
      if (!hits.length) return `No matching approved records for "${query}".`;
      return [FRAMING, ...hits.map((e) => formatEntry(e))].join("\n\n");
    }),
  );

  server.registerTool(
    "context_get",
    {
      title: "Get one shared record",
      description: "Returns one record by id, including what it replaces or was replaced by.",
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    guard(({ id }) => {
      const e = store.get(id);
      const agent = agentName();
      const visibleToAgent =
        e &&
        e.project === opts.project &&
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
      },
    },
    guard(({ ttl_days, ...rest }) => {
      const e = store.propose({ ...rest, ttlDays: ttl_days, project: opts.project, sourceAgent: agentName() });
      return `Proposed ${e.id} ("${e.title}"). It is pending human approval and is not yet visible to other agents.`;
    }),
  );

  return server;
}
