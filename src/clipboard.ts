import type { HostEnv } from "./host.js";

/**
 * Commands that put stdin on the clipboard, best first.
 * - Windows: clip.exe reads stdin in the console code page, so UTF-8 text ("Bağlam", "→", İ, ş) comes
 *   out garbled; PowerShell's Set-Clipboard, told to read stdin as UTF-8, keeps every letter.
 * - Linux: wl-copy on Wayland, then xclip and xsel for X11.
 */
function candidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): [string, string[]][] {
  if (platform === "win32") {
    return [[
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
    ]];
  }
  if (platform === "darwin") return [["pbcopy", []]];
  const x11: [string, string[]][] = [["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  return env.WAYLAND_DISPLAY ? [["wl-copy", []], ...x11] : x11;
}

/** Put `text` on the clipboard. False when no clipboard tool worked (the caller prints it instead). */
export function copyToClipboard(host: HostEnv, text: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const [cmd, args] of candidates(host.platform, env)) {
    if (!host.hasCommand(cmd)) continue;
    if (host.run(cmd, args, text).code === 0) return true;
  }
  return false;
}
