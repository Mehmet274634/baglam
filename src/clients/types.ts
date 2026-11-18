import type { HostEnv } from "../host.js";

export type ChangeAction = "added" | "updated" | "unchanged" | "removed" | "absent" | "skipped";

export interface Change {
  client: string;
  file: string;
  action: ChangeAction;
  note?: string;
  /** Set for the automatic-saving hooks; absent for the MCP server entry. */
  part?: "auto-save";
}

export interface ServerEntryShape {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClientStatus {
  installed: boolean;
  registered: boolean;
  entry?: ServerEntryShape;
  problem?: string;
}

export interface WriteOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
}

/** One AI tool Bağlam can register itself with. */
export interface ClientAdapter {
  /** Also the BAGLAM_AGENT id written into the tool's config. */
  id: string;
  label: string;
  detect(host: HostEnv): boolean;
  install(host: HostEnv, opts?: WriteOptions): Change;
  uninstall(host: HostEnv, opts?: WriteOptions): Change;
  status(host: HostEnv): ClientStatus;
}
