import { claudeCode } from "./claude.js";
import { codex } from "./codex.js";
import { antigravity, cursor, geminiCli, vscode, windsurf } from "./json.js";
import type { ClientAdapter } from "./types.js";

export type { Change, ChangeAction, ClientAdapter, ClientStatus } from "./types.js";

/** Every AI tool Bağlam knows how to connect to, in display order. */
export const ALL_CLIENTS: ClientAdapter[] = [claudeCode, codex, antigravity, geminiCli, cursor, windsurf, vscode];
