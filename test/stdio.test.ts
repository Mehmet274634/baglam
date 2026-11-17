import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(import.meta.dirname, "..");

describe("stdio entry points (built)", () => {
  beforeAll(() => {
    execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 60_000);

  for (const entry of [["dist/cli.js", "mcp"], ["dist/mcp.js"]]) {
    it(`${entry.join(" ")} serves MCP over stdio`, async () => {
      const work = mkdtempSync(join(tmpdir(), "baglam-stdio-"));
      const client = new Client({ name: "stdio-test", version: "1" });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: entry.map((p, i) => (i === 0 ? join(root, p) : p)),
          env: { ...process.env, BAGLAM_DB: join(work, "t.db"), BAGLAM_PROJECT: work } as Record<string, string>,
          stderr: "ignore",
        }),
      );
      try {
        const res = await client.callTool({
          name: "context_propose",
          arguments: { kind: "fact", title: "stdio works", body: "yes" },
        });
        expect((res.content as { text: string }[])[0].text).toMatch(/^Proposed c/);
      } finally {
        await client.close();
      }
    }, 20_000);
  }
});
