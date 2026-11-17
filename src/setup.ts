import { ALL_CLIENTS } from "./clients/index.js";
import type { Change, ClientAdapter } from "./clients/types.js";
import type { HostEnv } from "./host.js";

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

  const changes = detected.map((client): Change => {
    try {
      return opts.undo
        ? client.uninstall(host, { dryRun: opts.dryRun })
        : client.install(host, { dryRun: opts.dryRun });
    } catch (err) {
      return { client: client.id, file: "", action: "skipped", note: (err as Error).message };
    }
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
