import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ContextStore } from "../src/store.js";
import { createServer } from "../src/server.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });

async function connect(store: ContextStore, cwd: string, agent: string) {
  const server = createServer(store, { cwd, agent });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: agent, version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join("\n");

describe.skipIf(!hasGit)("handoff end to end", () => {
  it("resume after an abrupt stop", async () => {
    const repo = mkdtempSync(join(tmpdir(), "baglam-e2e-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "app");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "start");
    const store = new ContextStore(":memory:");

    // Agent A works, checkpoints twice, edits files, then dies without another checkpoint.
    const a = await connect(store, repo, "claude-code");
    await a.callTool({ name: "context_checkpoint", arguments: { goal: "Stripe checkout", now: "form validation", next: ["webhook handler", "refund tests"] } });
    await a.callTool({ name: "context_checkpoint", arguments: { done_add: ["form validation"], now: "webhook handler", next: ["verify signature", "refund tests"], files: ["src/webhook.ts"] } });
    writeFileSync(join(repo, "webhook.ts"), "export const handler = 1;");
    writeFileSync(join(repo, "refunds.test.ts"), "// started");
    await a.close(); // tokens ran out

    // Agent B, another vendor, opens the same project.
    const b = await connect(store, repo, "codex");
    const brief = text(await b.callTool({ name: "context_brief", arguments: {} }));
    expect(brief).toMatch(/## Continue from here/);
    expect(brief).toContain("Stripe checkout");
    expect(brief).toContain("form validation");
    expect(brief).toContain("1) verify signature");
    expect(brief).toMatch(/by claude-code/);
    expect(brief).toMatch(/Since then \(git\): 2 files changed, not committed: .*webhook\.ts/);
    expect(brief).toContain("refunds.test.ts");

    // B continues the same task: rewording the goal keeps the progress.
    await b.callTool({ name: "context_checkpoint", arguments: { goal: "Stripe checkout flow", done_add: ["verify signature"], next: ["refund tests"] } });
    const h = store.listHandoffs()[0];
    expect(h).toMatchObject({ goal: "Stripe checkout flow", agent: "codex", done: ["form validation", "verify signature"] });
    await b.close();
  });
});
