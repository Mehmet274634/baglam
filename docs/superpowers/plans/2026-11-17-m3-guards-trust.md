# Bağlam v1.0 · Milestone 3: Guards and trust rules · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep shared memory clean and safe: block secrets, flag duplicates, stop proposal floods, and let the owner opt in to auto-approval for agents they trust.

**Architecture:** A pure `guards.ts` (secret scanning) and a `policy.ts` that decides each proposal's fate (`blocked` → `refused` → `auto-approved` / `pending`, with duplicate hints) sit between the MCP server and `ContextStore`. The store gains schema v3 (`similar_to`), similarity search and trust-rule storage.

**Tech Stack:** as M1/M2; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-baglam-v1-design.md` §3 (propose outcomes, flood limit), §4 (guards), §5 (trust rules), "Settled after builder review" (agent identity, trust rules global or per project).

## Global Constraints
- Propose outcomes, exactly: `pending`, `auto-approved`, `blocked` (secret; nothing stored, reason given), `possible duplicate` (still queued, lists similar records, suggests `supersedes`).
- Flood limit default 20 pending proposals per agent per project; env `BAGLAM_FLOOD_LIMIT` overrides. Brief budget default 2,000 tokens; env `BAGLAM_BRIEF_BUDGET` overrides.
- Trust rules never match an unverified agent (name not set by `BAGLAM_AGENT`). Secret blocking and flood limits apply before trust rules. Default: no rules.
- Humans adding a record that looks like a secret get a warning and must confirm (`--force`).
- Secret findings shown to anyone are masked: type + first 4 characters + `…`.

## Review Focus
1. **Ordinary technical text that looks random** (git SHAs, UUIDs, base64 in docs, long file paths, package names): must not be blocked. → Task 1 test `does not flag hashes, uuids, paths or prose`.
2. **A proposal identical to an existing pending one** (agents re-proposing the same thing): flagged as duplicate, still queued. → Task 2 test `flags a duplicate of a pending proposal`.
3. **An auto-approve rule plus a proposal that supersedes a human decision**: must go to review, not silently replace. → Task 3 test `trust rules never auto-approve a supersede`.
4. **Rejected/superseded records counting toward the flood limit**: only pending counts. → Task 3 test `flood limit counts only pending`.
5. **Secret in rationale or tags, not body**: still blocked. → Task 1 test `scans every field`.

---

### Task 1: Secret scanner

**Files:** Create `src/guards.ts`. Test `test/guards.test.ts`.

**Interfaces (Produces):**
```ts
export interface SecretFinding { type: string; masked: string }
export function scanSecrets(text: string): SecretFinding[]
export function scanEntryFields(f: { title: string; body: string; rationale?: string | null; tags?: string[] }): SecretFinding[]
export function describeFindings(f: SecretFinding[]): string   // "AWS access key (AKIA…), GitHub token (ghp_…)"
```
Patterns (type label → regex): `AWS access key` `\bAKIA[0-9A-Z]{16}\b`; `GitHub token` `\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b`; `Anthropic API key` `\bsk-ant-[A-Za-z0-9_-]{20,}`; `OpenAI API key` `\bsk-(proj-)?[A-Za-z0-9_-]{20,}` (checked after Anthropic, skipping matches already reported); `Google API key` `\bAIza[0-9A-Za-z_-]{35}\b`; `Stripe key` `\b(sk|rk)_(live|test)_[0-9A-Za-z]{16,}\b`; `Slack token` `\bxox[abprs]-[0-9A-Za-z-]{10,}`; `Private key` `-----BEGIN [A-Z ]*PRIVATE KEY-----`; `JWT` `\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}`; `Password in URL` `\b[a-z][a-z0-9+.-]*://[^\s:/@]+:[^\s@/]+@`. High-entropy: tokens matching `[A-Za-z0-9+/_=-]{32,}` containing a letter and a digit, not pure hex, Shannon entropy > 4.2 bits/char → `High-entropy string`.

- [ ] **Step 1: Failing tests:** one `it` per pattern with a realistic fake (e.g. `AKIAIOSFODNN7EXAMPLE`), asserting `type` and that `masked` is the first 4 chars + `…`; `does not flag hashes, uuids, paths or prose` (40-hex SHA, UUID, `C:\Users\ev\Desktop\BAĞLAM\dist\cli.js`, `@modelcontextprotocol/sdk`, a Turkish sentence, `pnpm-lock.yaml`) → `[]`; `scans every field` (key only in `rationale`, then only in `tags`) → 1 finding each; `describeFindings` formats a comma list.
- [ ] **Step 2:** `npx vitest run test/guards.test.ts` → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(guards): secret scanner`.

### Task 2: Duplicate detection (schema v3)

**Files:** Modify `src/migrate.ts` (v3), `src/store.ts`. Test `test/duplicates.test.ts`, `test/migrate.test.ts`.

**Interfaces (Produces):**
- Schema v3: `ALTER TABLE entries ADD COLUMN similar_to TEXT NOT NULL DEFAULT '[]'`. `Entry.similarTo: string[]`.
- `ContextStore.findSimilar(project: string, text: { title: string; body: string }, opts?: { kind?: Kind; excludeId?: string; limit?: number }): Entry[]`. Candidates: same project, status `approved` (not expired) or `proposed`, top 10 by FTS (`OR` of up to 24 distinct words of ≥ 3 letters from title+body, lower-cased). Keep candidates whose word-set Jaccard similarity on title+body ≥ 0.5, or title Jaccard ≥ 0.8; best first; default limit 3.
- `ContextStore.propose` accepts optional `similarTo?: string[]` and stores it.

- [ ] **Step 1: Failing tests:** `finds a near-identical approved record`; `flags a duplicate of a pending proposal`; `ignores other projects and rejected records`; `unrelated text is not similar`; `respects kind filter`; migrate: fresh DB `user_version` = 3 and v2 file upgrades with `similar_to` defaulting to `[]`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (update `SCHEMA_VERSION` tests that expect 2 → now `SCHEMA_VERSION`). **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(store): duplicate detection (schema v3)`.

### Task 3: Trust rules and the proposal policy

**Files:** Create `src/policy.ts`; modify `src/store.ts`, `src/server.ts`, `src/format.ts`. Test `test/policy.test.ts`, `test/server.test.ts`.

**Interfaces:**
- Store:
  ```ts
  export interface TrustRule { id: string; projectId: string | null; agent: string | null; kind: Kind | null; createdAt: number }
  addTrustRule(r: { projectId: string | null; agent?: string; kind?: Kind }): TrustRule   // needs agent or kind, else throws /agent or kind/
  listTrustRules(projectId?: string): TrustRule[]   // with projectId: that project's + global
  removeTrustRule(id: string): boolean
  matchTrustRule(project: string, agent: string, kind: Kind): TrustRule | undefined
  approve(id, by, note?, opts?: { auto?: boolean })  // auto sets auto_approved = 1
  countPending(project: string, agent: string): number
  ```
- Policy:
  ```ts
  export type ProposalOutcome =
    | { status: "blocked"; findings: SecretFinding[] }
    | { status: "refused"; reason: string }
    | { status: "pending"; entry: Entry; similar: Entry[] }
    | { status: "auto-approved"; entry: Entry; rule: TrustRule }
  export function submitProposal(store: ContextStore, input: NewEntry & { sourceAgent: string }, ctx: { agentVerified: boolean; floodLimit: number }): ProposalOutcome
  export function floodLimitFromEnv(): number   // BAGLAM_FLOOD_LIMIT, default 20
  ```
  Order: secrets → flood (`countPending >= floodLimit` → refused: "N proposals are already waiting for review; stop proposing until the owner reviews them") → similar (`findSimilar`, stored in `similarTo`) → trust rule (only if `agentVerified`, no `supersedes`, and no similar records) → else pending. Auto-approved records are approved by `trust-rule:<rule id>`.
- Server: `context_propose` uses `submitProposal`; `agentVerified = opts.agent !== undefined`. Replies: blocked → tool error "Not stored: it looks like it contains a secret (…). Remove it and propose again."; refused → tool error with reason; pending → existing text, plus for duplicates "Similar records already exist: <id> \"title\" … If yours replaces one, propose again with supersedes."; auto-approved → "Saved <id> and shared with other agents (auto-approved by a trust rule the owner set)."
- `formatEntry` shows `auto-approved` instead of `approved by …` when `autoApproved`. Brief budget reads `BAGLAM_BRIEF_BUDGET`.

- [ ] **Step 1: Failing tests** (`test/policy.test.ts`): `blocks a secret and stores nothing`; `flood limit counts only pending` (20 pending → 21st refused; reject one → accepted); `auto-approves with a matching rule for a verified agent`; `never auto-approves an unverified agent`; `trust rules never auto-approve a supersede`; `duplicates go to review even with a rule`; `project rule does not apply to another project; global rule does`; `addTrustRule needs agent or kind`. Server: `blocked proposal is a tool error and stores nothing`, `duplicate reply lists the similar record`, `auto-approved reply with BAGLAM_AGENT set`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(policy): trust rules, flood limit, secret blocking in propose`.

### Task 4: CLI

**Files:** Modify `src/cli.ts`. Test `test/cli.test.ts`.

**Interfaces:**
- `baglam add …` scans fields; findings → print "This looks like it contains a secret: … Add --force to store it anyway." exit 1, nothing stored; with `--force` stores.
- `baglam trust add [--agent <id>] [--kind <kind>] [--global]` (default scope: current project), `baglam trust list`, `baglam trust remove <id>`. `add` prints a one-line summary and the warning "Records matching this rule skip your review."
- `baglam pending` marks proposals with `similarTo` as `possible duplicate of <ids>`.
- USAGE lists the trust commands.

- [ ] **Step 1: Failing tests:** `add refuses a secret without --force`, `add --force stores it`, `trust add/list/remove`, `trust add needs --agent or --kind`, `pending shows duplicate hints`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(cli): trust rules, secret check on add, duplicate hints`.
