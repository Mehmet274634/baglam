import { describe, it, expect } from "vitest";
import { describeFindings, scanEntryFields, scanSecrets } from "../src/guards.js";

// Fakes are assembled at runtime so this file itself never contains a real-looking secret.
const join = (...p: string[]) => p.join("");
const FAKES: [string, string][] = [
  ["AWS access key", join("AKIA", "IOSFODNN7EXAMPLE")],
  ["GitHub token", join("ghp_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8")],
  ["GitHub token", join("github_pat_", "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK")],
  ["Anthropic API key", join("sk-ant-", "api03-AbCdEfGhIjKlMnOpQrStUvWx")],
  ["OpenAI API key", join("sk-", "proj-AbCdEfGhIjKlMnOpQrStUvWx12")],
  ["Google API key", join("AIza", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q")],
  ["Stripe key", join("sk_", "live_", "4eC39HqLyjWDarjtT1zdp7dc")],
  ["Slack token", join("xoxb-", "123456789012-abcdefABCDEF")],
  ["Private key", join("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIEow")],
  ["JWT", join("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJ", "zdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")],
  ["Password in URL", join("postgres://", "admin:", "hunter2pass", "@db.example.com:5432/app")],
  ["High-entropy string", join("Zx9", "Qw7rT2mN8vB4kL6pH3sD5fG1jA0cE9uY")],
];

describe("scanSecrets", () => {
  for (const [type, value] of FAKES) {
    it(`detects ${type}: ${value.slice(0, 8)}…`, () => {
      const found = scanSecrets(`Here it is: ${value} — use it.`);
      expect(found.map((f) => f.type)).toContain(type);
      const f = found.find((x) => x.type === type)!;
      expect(f.masked).toMatch(/^.{1,4}…$/);
      expect(f.masked).not.toContain(value.slice(4, 8));
    });
  }

  it("reports an Anthropic key once, not also as OpenAI", () => {
    const found = scanSecrets(join("key ", "sk-ant-", "api03-AbCdEfGhIjKlMnOpQrStUvWx"));
    expect(found.map((f) => f.type)).toEqual(["Anthropic API key"]);
  });

  it("does not flag hashes, uuids, paths or prose", () => {
    const benign = [
      "Commit 3ec4eb0f1f64e74a1b2c3d4e5f60718293a4b5c6 fixed it.",
      "Project id 8a97f68e-97b5-4ddf-9978-e1ae025dd821.",
      String.raw`Run C:\Users\ev\Desktop\BAĞLAM\dist\cli.js mcp`,
      "Install @modelcontextprotocol/sdk and zod, see pnpm-lock.yaml.",
      "Bu projede paket yöneticisi olarak pnpm kullanıyoruz; package-lock.json oluşturmayın.",
      "Use the useEffectEventHandlerWithCleanupAndRetry hook in components.",
      "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md",
    ];
    for (const text of benign) expect(scanSecrets(text), text).toEqual([]);
  });
});

describe("scanEntryFields", () => {
  const key = join("AKIA", "IOSFODNN7EXAMPLE");
  it("scans every field", () => {
    expect(scanEntryFields({ title: "t", body: "b", rationale: `because ${key}` })).toHaveLength(1);
    expect(scanEntryFields({ title: "t", body: "b", tags: ["x", key] })).toHaveLength(1);
    expect(scanEntryFields({ title: key, body: "b" })).toHaveLength(1);
    expect(scanEntryFields({ title: "t", body: "b" })).toEqual([]);
  });
});

describe("describeFindings", () => {
  it("formats a comma list", () => {
    expect(describeFindings([{ type: "AWS access key", masked: "AKIA…" }, { type: "JWT", masked: "eyJh…" }])).toBe(
      "AWS access key (AKIA…), JWT (eyJh…)",
    );
  });
});
