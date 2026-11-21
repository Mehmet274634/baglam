import { describe, it, expect } from "vitest";
import { testHost } from "./helpers.js";
import { copyToClipboard } from "../src/clipboard.js";
import { realHost, type RunOptions } from "../src/host.js";

const TEXT = "Bağlam → İmza, ışık, şöğüç";

function host(platform: NodeJS.Platform, ok: string[]) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const commands = Object.fromEntries(
    ok.map((cmd) => [cmd, (args: string[], input?: string) => (calls.push({ cmd, args, input }), { code: 0 })]),
  );
  return { h: { ...testHost({ commands }), platform }, calls };
}

describe("copyToClipboard", () => {
  it("Windows: PowerShell Set-Clipboard reading UTF-8, never clip.exe (it garbles ğ, ş, İ, →)", () => {
    const { h, calls } = host("win32", ["powershell", "clip"]);
    expect(copyToClipboard(h, TEXT, {})).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("powershell");
    expect(calls[0].args.join(" ")).toMatch(/InputEncoding.*UTF8.*Set-Clipboard/);
    expect(calls[0].input).toBe(TEXT);
  });

  it("macOS: pbcopy", () => {
    const { h, calls } = host("darwin", ["pbcopy"]);
    expect(copyToClipboard(h, TEXT, {})).toBe(true);
    expect(calls.map((c) => c.cmd)).toEqual(["pbcopy"]);
  });

  it("Linux on Wayland: wl-copy first; otherwise xclip, then xsel", () => {
    const wayland = host("linux", ["wl-copy", "xclip", "xsel"]);
    expect(copyToClipboard(wayland.h, TEXT, { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(wayland.calls.map((c) => c.cmd)).toEqual(["wl-copy"]);
    const x11 = host("linux", ["xsel"]);
    expect(copyToClipboard(x11.h, TEXT, {})).toBe(true);
    expect(x11.calls.map((c) => [c.cmd, ...c.args])).toEqual([["xsel", "--clipboard", "--input"]]);
  });

  it("no clipboard tool: false (the caller prints the text instead)", () => {
    const { h } = host("linux", []);
    expect(copyToClipboard(h, TEXT, {})).toBe(false);
  });

  it("asks the host not to wait for output: wl-copy and xclip leave a process behind holding the clipboard", () => {
    const seen: (RunOptions | undefined)[] = [];
    const h = { ...testHost({ commands: { "wl-copy": (_a, _i, o) => (seen.push(o), { code: 0 }) } }), platform: "linux" as const };
    expect(copyToClipboard(h, TEXT, { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(seen[0]?.background).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("realHost().run with background: true", () => {
  it("returns when the command exits, even if a child it left behind still holds stdout/stderr", () => {
    const started = Date.now();
    const r = realHost().run("sh", ["-c", "sleep 20 & exit 0"], "text", { background: true });
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});
