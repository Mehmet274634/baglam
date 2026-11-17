import { describe, it, expect } from "vitest";
import { windowsCommandLine, writeFileAtomic } from "../src/host.js";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("windowsCommandLine", () => {
  it("quotes every part so spaces and non-ASCII survive cmd.exe", () => {
    const shim = String.raw`C:\Users\ev\AppData\Roaming\npm\claude.cmd`;
    const node = String.raw`C:\Program Files\nodejs\node.exe`;
    const cli = String.raw`C:\Users\ev\Desktop\BAĞLAM\dist\cli.js`;
    expect(windowsCommandLine(shim, ["mcp", "add", "--", node, cli])).toBe(
      `"${shim}" "mcp" "add" "--" "${node}" "${cli}"`,
    );
  });

  it("doubles inner quotes; & and spaces are literal inside quotes", () => {
    expect(windowsCommandLine("x.cmd", ['a"b', "c&d"])).toBe('"x.cmd" "a""b" "c&d"');
  });

  it("refuses % and line breaks, which cmd.exe would interpret even inside quotes", () => {
    expect(() => windowsCommandLine("x.cmd", ["e%PATH%f"])).toThrow(/cannot pass/);
    expect(() => windowsCommandLine("x.cmd", ["a\nb"])).toThrow(/cannot pass/);
  });
});

describe("writeFileAtomic", () => {
  it("writes the full content and leaves no temp files", () => {
    const dir = mkdtempSync(join(tmpdir(), "baglam-atomic-"));
    const file = join(dir, "mcp.json");
    writeFileAtomic(file, "first");
    writeFileAtomic(file, "second");
    expect(readFileSync(file, "utf8")).toBe("second");
    expect(readdirSync(dir)).toEqual(["mcp.json"]);
  });
});
