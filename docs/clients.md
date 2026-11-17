# Connecting each tool

`baglam setup` does all of this for you. This page is for checking what it did, or connecting a tool by hand.

Every tool gets the same server entry: the absolute path of Node, the absolute path of Bağlam's `dist/cli.js`, the argument `mcp`, and `BAGLAM_AGENT` set to the tool's id. Absolute paths matter because desktop apps often start without your shell's `PATH`.

Find the two paths:

```bash
node -p "process.execPath"
npm root -g          # Bağlam is in <this>/baglam/dist/cli.js
```

Below, `NODE` and `CLI` stand for those two paths.

| Tool | Agent id | Config file | How setup writes it |
|---|---|---|---|
| Claude Code | `claude-code` | `~/.claude.json` | `claude mcp add baglam -s user -e BAGLAM_AGENT=claude-code -- NODE CLI mcp` |
| Codex CLI | `codex` | `~/.codex/config.toml` | fenced TOML block (below) |
| Antigravity | `antigravity` | `~/.gemini/antigravity/mcp_config.json` | `mcpServers.baglam` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `mcpServers.baglam` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `mcpServers.baglam` |
| Windsurf | `windsurf` | `~/.codeium/windsurf/mcp_config.json` | `mcpServers.baglam` |
| VS Code | `vscode` | user `mcp.json` (Windows `%APPDATA%\Code\User\mcp.json`, macOS `~/Library/Application Support/Code/User/mcp.json`, Linux `~/.config/Code/User/mcp.json`) | `servers.baglam` with `"type": "stdio"` |

## JSON tools (Antigravity, Gemini CLI, Cursor, Windsurf)

```json
{
  "mcpServers": {
    "baglam": {
      "command": "NODE",
      "args": ["CLI", "mcp"],
      "env": { "BAGLAM_AGENT": "cursor" }
    }
  }
}
```

Use the tool's own agent id from the table. VS Code uses `"servers"` instead of `"mcpServers"` and adds `"type": "stdio"`.

Setup keeps every other server and setting in the file. If the file is not plain JSON (for example it has comments), setup leaves it untouched and tells you; add the entry by hand.

## Codex CLI

```toml
# baglam:start
[mcp_servers.baglam]
command = "NODE"
args = ["CLI", "mcp"]
env = { BAGLAM_AGENT = "codex" }
# baglam:end
```

On Windows, write backslashes doubled (`"C:\\Program Files\\nodejs\\node.exe"`). If your file already defines `mcp_servers` in another layout, setup will not touch it; merge the entry by hand.

## Instructions for agents

`baglam init` adds this block to `CLAUDE.md`, `AGENTS.md` (read by Codex, Cursor and most other agents), `GEMINI.md` (Gemini CLI, Antigravity) and `.cursor/rules/baglam.mdc`. You can also paste it into any rules file your tool reads:

```markdown
## Shared project context (Bağlam)
This project uses Bağlam to share decisions between AI agents.
- At the start of every task, call the `context_brief` tool with `project_path` set to the absolute path of this project folder, and follow what it returns.
- When you settle a decision, learn a convention or a user preference, or hit a pitfall other agents should know about, call `context_propose` (same `project_path`). Use `supersedes` when it replaces an existing record.
- Never put secrets, credentials or personal data in a proposal.
```

## Undo

```bash
baglam setup --undo     # removes Bağlam from every tool
baglam init --undo      # removes the instruction blocks from this project (keeps its id)
```

The first backup of every changed file stays next to it as `*.baglam-backup`.
