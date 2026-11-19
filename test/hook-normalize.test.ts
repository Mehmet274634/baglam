import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HOOK_CLIENTS, neutralOutput, normalize, type HookClient, type HookEvent } from "../src/hooks/normalize.js";

const DIR = resolve(tmpdir(), "baglam-norm");
const at = (...p: string[]) => join(DIR, ...p);

describe("claude-code", () => {
  it("prompt, edits and reply", () => {
    expect(normalize("claude-code", "prompt", { cwd: DIR, prompt: "Build a todo app" })).toEqual({ cwd: DIR, event: { kind: "prompt", text: "Build a todo app" } });
    expect(normalize("claude-code", "edit", { cwd: DIR, tool_name: "Edit", tool_input: { file_path: at("a.ts") } }).event).toEqual({ kind: "edit", files: [at("a.ts")] });
    expect(normalize("claude-code", "edit", { cwd: DIR, tool_name: "NotebookEdit", tool_input: { notebook_path: "n.ipynb" } }).event).toEqual({ kind: "edit", files: [at("n.ipynb")] });
    expect(normalize("claude-code", "stop", { cwd: DIR, last_assistant_message: "Done: added index.html" }).event).toEqual({ kind: "stop", reply: "Done: added index.html" });
  });

  it("stop without last_assistant_message reads the last assistant text from the transcript", () => {
    const t = join(mkdtempSync(join(tmpdir(), "baglam-tr-")), "t.jsonl");
    writeFileSync(
      t,
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "First" }] } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit" }, { type: "text", text: "Added search." }, { type: "text", text: "Tests pass." }] } }),
        "not json",
      ].join("\n"),
    );
    expect(normalize("claude-code", "stop", { cwd: DIR, transcript_path: t }).event).toEqual({ kind: "stop", reply: "Added search.\nTests pass." });
  });
});

describe("codex", () => {
  it("apply_patch edits list every file in the patch", () => {
    const command = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: b.md\n+hello\n*** Delete File: old.txt\n*** End Patch";
    expect(normalize("codex", "edit", { cwd: DIR, tool_name: "apply_patch", tool_input: { command } }).event).toEqual({
      kind: "edit",
      files: [at("src", "a.ts"), at("b.md"), at("old.txt")],
    });
  });

  it("prompt and reply", () => {
    expect(normalize("codex", "prompt", { cwd: DIR, prompt: "devam et" }).event).toEqual({ kind: "prompt", text: "devam et" });
    expect(normalize("codex", "stop", { cwd: DIR, last_assistant_message: "Search added" }).event).toEqual({ kind: "stop", reply: "Search added" });
  });

  it("shell commands are not edits", () => {
    expect(normalize("codex", "edit", { cwd: DIR, tool_name: "Bash", tool_input: { command: "ls" } }).event).toBeUndefined();
  });
});

describe("gemini-cli", () => {
  it("prompt, edits and reply", () => {
    expect(normalize("gemini-cli", "prompt", { cwd: DIR, prompt: "p" }).event).toEqual({ kind: "prompt", text: "p" });
    expect(normalize("gemini-cli", "edit", { cwd: DIR, tool_name: "write_file", tool_input: { file_path: "w.txt" } }).event).toEqual({ kind: "edit", files: [at("w.txt")] });
    expect(normalize("gemini-cli", "edit", { cwd: DIR, tool_name: "replace", tool_input: { file_path: at("r.txt") } }).event).toEqual({ kind: "edit", files: [at("r.txt")] });
    expect(normalize("gemini-cli", "stop", { cwd: DIR, prompt: "p", prompt_response: "All done" }).event).toEqual({ kind: "stop", reply: "All done" });
  });
});

describe("cursor", () => {
  it("uses the first workspace root as the folder", () => {
    expect(normalize("cursor", "prompt", { prompt: "Add filters", workspace_roots: [DIR] })).toEqual({ cwd: DIR, event: { kind: "prompt", text: "Add filters" } });
    expect(normalize("cursor", "edit", { file_path: at("x.ts"), workspace_roots: [DIR] }).event).toEqual({ kind: "edit", files: [at("x.ts")] });
    expect(normalize("cursor", "stop", { text: "Filters work", workspace_roots: [DIR] }).event).toEqual({ kind: "stop", reply: "Filters work" });
  });

  it("Windows-style workspace roots like /c:/Users/... are read as paths", () => {
    expect(normalize("cursor", "prompt", { prompt: "x", workspace_roots: ["/c:/Users/ev/p"] }).cwd).toBe(resolve("c:/Users/ev/p"));
  });
});

describe("antigravity", () => {
  it("only the first model call of a turn is the user's request", () => {
    expect(normalize("antigravity", "prompt", { lastUserInput: "Add dark mode", invocationNum: 0, workspacePaths: [DIR] })).toEqual({
      cwd: DIR,
      event: { kind: "prompt", text: "Add dark mode" },
    });
    expect(normalize("antigravity", "prompt", { lastUserInput: "Add dark mode", invocationNum: 3, workspacePaths: [DIR] }).event).toBeUndefined();
  });

  it("file tools give TargetFile", () => {
    const e = normalize("antigravity", "edit", { toolCall: { name: "replace_file_content", args: { TargetFile: at("app.js") } }, workspacePaths: [DIR] });
    expect(e.event).toEqual({ kind: "edit", files: [at("app.js")] });
    expect(normalize("antigravity", "edit", { toolCall: { name: "run_command", args: { CommandLine: "ls" } }, workspacePaths: [DIR] }).event).toBeUndefined();
  });

  it("Antigravity 2 (recorded payloads): write_file and edit_file give Path", () => {
    const base = { hookEventName: "PostToolUse", cwd: DIR, workspacePaths: [DIR], error: "" };
    const write = { ...base, toolCall: { name: "write_file", args: { Path: at("data.js"), Content: "x", Overwrite: "true" } } };
    const edit = { ...base, toolCall: { name: "edit_file", args: { Path: at("index.html"), Target: "a", Replacement: "b" } } };
    expect(normalize("antigravity", "edit", write).event).toEqual({ kind: "edit", files: [at("data.js")] });
    expect(normalize("antigravity", "edit", edit).event).toEqual({ kind: "edit", files: [at("index.html")] });
    const read = { ...base, toolCall: { name: "read_file", args: { Path: at("app.js") } } };
    expect(normalize("antigravity", "edit", read).event).toBeUndefined();
  });
});

describe("vscode", () => {
  it("prompt and edits with either path spelling", () => {
    expect(normalize("vscode", "prompt", { cwd: DIR, prompt: "p" }).event).toEqual({ kind: "prompt", text: "p" });
    expect(normalize("vscode", "edit", { cwd: DIR, tool_input: { filePath: at("v.ts") } }).event).toEqual({ kind: "edit", files: [at("v.ts")] });
    expect(normalize("vscode", "edit", { cwd: DIR, toolArgs: { path: "w.ts" } }).event).toEqual({ kind: "edit", files: [at("w.ts")] });
  });
});

describe("anything unexpected", () => {
  const events: HookEvent[] = ["prompt", "edit", "stop"];
  it.each(HOOK_CLIENTS.flatMap((c) => events.map((e) => [c, e] as [HookClient, HookEvent])))("%s %s ignores garbage", (c, e) => {
    for (const input of [null, "x", 42, [], {}, { prompt: 5, tool_input: "no", workspace_roots: "no" }]) {
      expect(() => normalize(c, e, input)).not.toThrow();
      expect(normalize(c, e, input).event).toBeUndefined();
    }
  });
});

describe("neutral output", () => {
  it("never blocks or injects anything", () => {
    expect(neutralOutput("claude-code", "prompt")).toBe("");
    expect(neutralOutput("codex", "stop")).toBe("");
    expect(neutralOutput("vscode", "prompt")).toBe("");
    expect(neutralOutput("gemini-cli", "prompt")).toBe("{}");
    expect(neutralOutput("antigravity", "edit")).toBe("{}");
    expect(neutralOutput("cursor", "prompt")).toBe('{"continue":true}');
    expect(neutralOutput("cursor", "edit")).toBe("{}");
  });
});
