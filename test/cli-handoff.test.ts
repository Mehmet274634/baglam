import { describe, it, expect, beforeEach } from "vitest";
import { ContextStore } from "../src/store.js";
import { runCli, type CliContext } from "../src/cli.js";
import { testHost, type TestHost } from "./helpers.js";

const P = "c:/work/app";

describe("baglam auto / handoff / review", () => {
  let store: ContextStore;
  let out: string[];
  let host: TestHost;
  const ctx = (over: Partial<CliContext> = {}): CliContext => ({
    store, project: P, user: "human:ev", print: (s) => out.push(s), host, interactive: false, ...over,
  });
  const run = (argv: string[], over: Partial<CliContext> = {}) => {
    out = [];
    return runCli(argv, ctx(over)) as number;
  };
  const runAsync = async (argv: string[]) => {
    out = [];
    return await runCli(argv, ctx());
  };

  beforeEach(() => {
    store = new ContextStore(":memory:");
    host = testHost();
    out = [];
  });

  it("auto status says off by default and explains the rules", () => {
    expect(run(["auto", "status"])).toBe(0);
    expect(out.join("\n")).toMatch(/Autonomous mode is off/);
  });

  it("auto on needs --yes when not interactive", () => {
    expect(run(["auto", "on"])).toBe(1);
    expect(out.join("\n")).toMatch(/--yes/);
    expect(store.isAutonomous(P)).toBe(false);
    expect(run(["auto", "on", "--yes"])).toBe(0);
    expect(store.isAutonomous(P)).toBe(true);
    expect(out.join("\n")).toMatch(/secrets are always blocked/i);
    expect(run(["auto", "off"])).toBe(0);
    expect(store.isAutonomous(P)).toBe(false);
  });

  it("auto on asks when interactive", () => {
    let asked = "";
    expect(run(["auto", "on"], { interactive: true, confirm: (labels) => ((asked = labels.join()), true) })).toBe(0);
    expect(asked).toMatch(/autonomous/i);
    expect(store.isAutonomous(P)).toBe(true);
  });

  it("handoff shows the live task, history and clears it", () => {
    expect(run(["handoff", "--branch", "main"])).toBe(0);
    expect(out.join("\n")).toMatch(/No task in progress/);
    store.checkpoint({ project: P, branch: "main", agent: "claude-code", goal: "Stripe checkout", now: "webhook", next: ["tests"] });
    expect(run(["handoff", "--branch", "main"])).toBe(0);
    expect(out.join("\n")).toMatch(/Continue from here/);
    expect(out.join("\n")).toContain("Stripe checkout");
    expect(run(["handoff", "--branch", "main", "--history"])).toBe(0);
    expect(out.join("\n")).toMatch(/claude-code/);
    expect(run(["handoff", "clear", "--branch", "main"])).toBe(0);
    expect(store.getHandoff(P, "main")?.status).toBe("done");
  });

  it("handoff --copy puts a resume prompt on the clipboard", async () => {
    store.checkpoint({ project: P, branch: "main", agent: "claude-code", goal: "Stripe checkout", next: ["tests"] });
    const clip = process.platform === "win32" ? "powershell" : process.platform === "darwin" ? "pbcopy" : "xclip";
    let copied = "";
    host = testHost({ commands: { [clip]: (_args, input) => ((copied = input ?? ""), { code: 0 }) } });
    expect(await runAsync(["handoff", "--branch", "main", "--copy"])).toBe(0);
    expect(copied).toMatch(/continuing a task/i);
    expect(copied).toContain("Stripe checkout");
    expect(out.join("\n")).toMatch(/Copied/);
  });

  it("handoff --copy falls back to printing", async () => {
    store.checkpoint({ project: P, branch: "main", agent: "claude-code", goal: "Stripe checkout" });
    expect(await runAsync(["handoff", "--branch", "main", "--copy"])).toBe(0);
    expect(out.join("\n")).toMatch(/Could not reach the clipboard/);
    expect(out.join("\n")).toContain("Stripe checkout");
  });

  it("review, keep and undo", () => {
    const share = (title: string) =>
      store.approve(store.propose({ project: P, kind: "decision", title, body: `${title} body`, sourceAgent: "codex" }).id, "autonomous-mode", undefined, { auto: true, review: true });
    const a = share("Use Vite");
    const b = share("Use Vitest");
    const c = share("Use Biome");
    expect(run(["review"])).toBe(0);
    expect(out.join("\n")).toContain(a.id);
    expect(run(["keep", a.id])).toBe(0);
    expect(store.get(a.id)?.reviewState).toBe("kept");
    expect(run(["undo", b.id])).toBe(0);
    expect(store.get(b.id)?.status).toBe("rejected");
    expect(run(["keep", "--all"])).toBe(0);
    expect(store.get(c.id)?.reviewState).toBe("kept");
    expect(run(["review"])).toBe(0);
    expect(out.join("\n")).toMatch(/Nothing to review/);
  });

  it("capture off, on and status", () => {
    expect(run(["capture", "status"])).toBe(0);
    expect(out.join("\n")).toMatch(/Automatic saving is on/);
    expect(run(["capture", "off"])).toBe(0);
    expect(store.isAutoCapture(P)).toBe(false);
    expect(out.join("\n")).toMatch(/Automatic saving is off/);
    expect(run(["capture", "on"])).toBe(0);
    expect(store.isAutoCapture(P)).toBe(true);
    expect(run(["capture", "maybe"])).toBe(1);
  });
});
