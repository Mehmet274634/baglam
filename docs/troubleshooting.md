# Troubleshooting

Start with:

```bash
baglam doctor
```

Run it inside the project folder you care about. Each `✗` line comes with a fix. The common ones:

| What doctor says | What it means | Fix |
|---|---|---|
| `Node.js — … too old` | Bağlam needs Node 22.13+ (built-in SQLite). | Install Node 22 LTS or newer. |
| `Database — … newer version of Bağlam` | Another, newer Bağlam wrote this file. | `npm i -g baglam@latest` |
| `<Tool>: registered — Bağlam is not connected to it` | The tool is installed but has no Bağlam entry. | `baglam setup`, then restart the tool. |
| `<Tool>: registered — points at …, not this install` | The entry points at an older copy (for example a moved folder). | `baglam setup` |
| `<Tool>: connects — …` | The entry exists but the server did not start or answer. The message is the reason (for example `spawn ENOENT` = Node not found at that path). | `baglam setup`, then restart the tool. |
| `This folder — … is not initialised` | Agents here can still use Bağlam, but the folder has no stable id and no instructions. | `baglam init` |
| `Agent instructions — agents in this folder are not told to use Bağlam` | `AGENTS.md` has no Bağlam block. | `baglam init` |

## Other situations

**An agent says "Bağlam could not tell which project you are working in."**
Its tool started the server outside your project and sent no workspace folder. The instruction block from `baglam init` tells agents to pass `project_path`; ask the agent to pass it, or run `baglam init` in the project.

**"Your workspace has several projects …"**
The tool has more than one folder open. The agent should pass `project_path` for the one it is working in.

**A proposal was blocked as a secret but it isn't one.**
Rephrase it or remove the token. As the owner you can add it yourself with `baglam add … --force` (shown to all your agents, so be sure).

**"N proposals are already waiting for review"**
That agent has 20 proposals waiting (`BAGLAM_FLOOD_LIMIT` changes the limit). Review them in `baglam ui`.

**The panel says "Open the panel again".**
Its link works once. Run `baglam ui` again for a fresh one.

**Setup skipped a tool: "not valid JSON".**
The tool's config file has comments or a typo. Setup never rewrites a file it cannot read safely; fix the file or add the entry by hand (see [clients.md](clients.md)).

**Undo everything**

```bash
baglam setup --undo
baglam init --undo        # in each project
```

Your records stay in `~/.baglam/baglam.db`; delete that folder to remove them too.
