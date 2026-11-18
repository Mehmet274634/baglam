import { ALL_CLIENTS } from "./clients/index.js";
import type { Change, ClientAdapter } from "./clients/types.js";
import type { HostEnv } from "./host.js";
import { HOOK_INSTALLERS } from "./clients/hooks.js";
import type { HookClient } from "./hooks/normalize.js";

export interface SetupOptions {
  undo?: boolean;
  dryRun?: boolean;
  /** Asked once with the detected tools; false cancels without changing anything. */
  confirm: (detected: ClientAdapter[]) => boolean;
  clients?: ClientAdapter[];
}

export interface SetupResult {
  detected: string[];
  changes: Change[];
}

/** Connect (or with `undo`, disconnect) Bağlam to every AI tool installed on this machine. */
export function runSetup(host: HostEnv, opts: SetupOptions): SetupResult {
  const detected = (opts.clients ?? ALL_CLIENTS).filter((c) => {
    try {
      return c.detect(host);
    } catch {
      return false;
    }
  });
  if (!detected.length || !opts.confirm(detected)) return { detected: detected.map((c) => c.id), changes: [] };

  const attempt = (client: ClientAdapter, part: Change["part"], fn: () => Change): Change => {
    try {
      return fn();
    } catch (err) {
      return { client: client.id, file: "", action: "skipped", note: (err as Error).message, ...(part ? { part } : {}) };
    }
  };
  const changes = detected.flatMap((client): Change[] => {
    const w = { dryRun: opts.dryRun };
    const server = attempt(client, undefined, () => (opts.undo ? client.uninstall(host, w) : client.install(host, w)));
    // Automatic saving: the tool's own hooks record requests, edited files and replies.
    const hooks = HOOK_INSTALLERS[client.id as HookClient];
    if (!hooks) return [server];
    return [server, attempt(client, "auto-save", () => (opts.undo ? hooks.uninstall(host, w) : hooks.install(host, w)))];
  });
  return { detected: detected.map((c) => c.id), changes };
}

export function detectClients(host: HostEnv, clients: ClientAdapter[] = ALL_CLIENTS): ClientAdapter[] {
  return clients.filter((c) => {
    try {
      return c.detect(host);
    } catch {
      return false;
    }
  });
}
