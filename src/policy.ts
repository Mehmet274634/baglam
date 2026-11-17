import type { ContextStore, Entry, NewEntry, TrustRule } from "./store.js";
import { scanEntryFields, type SecretFinding } from "./guards.js";

export type ProposalOutcome =
  | { status: "blocked"; findings: SecretFinding[] }
  | { status: "refused"; reason: string }
  | { status: "pending"; entry: Entry; similar: Entry[] }
  | { status: "auto-approved"; entry: Entry; rule: TrustRule };

export interface PolicyContext {
  /** True only when the agent's name came from BAGLAM_AGENT (set by setup), not from the client. */
  agentVerified: boolean;
  floodLimit: number;
}

export const DEFAULT_FLOOD_LIMIT = 20;

export function floodLimitFromEnv(): number {
  const n = Number(process.env.BAGLAM_FLOOD_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_FLOOD_LIMIT;
}

/**
 * Decide what happens to an agent's proposal, in this order:
 * secrets → flood limit → similar records → trust rule → pending review.
 */
export function submitProposal(
  store: ContextStore,
  input: NewEntry & { sourceAgent: string },
  ctx: PolicyContext,
): ProposalOutcome {
  const findings = scanEntryFields(input);
  if (findings.length) return { status: "blocked", findings };

  const waiting = store.countPending(input.project, input.sourceAgent);
  if (waiting >= ctx.floodLimit) {
    return {
      status: "refused",
      reason: `${waiting} proposals are already waiting for review; stop proposing until the owner reviews them.`,
    };
  }

  const similar = store.findSimilar(input.project, { title: input.title, body: input.body }, { kind: input.kind });
  const entry = store.propose({ ...input, similarTo: similar.map((e) => e.id) });

  // Trust rules only shortcut clean, additive records: never replacements, never look-alikes.
  const rule =
    ctx.agentVerified && !input.supersedes && !similar.length
      ? store.matchTrustRule(input.project, input.sourceAgent, input.kind)
      : undefined;
  if (rule) {
    return { status: "auto-approved", entry: store.approve(entry.id, `trust-rule:${rule.id}`, undefined, { auto: true }), rule };
  }
  return { status: "pending", entry, similar };
}
