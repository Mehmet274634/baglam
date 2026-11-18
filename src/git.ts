import { execFile, spawnSync } from "node:child_process";

/** What git can tell the next agent without any help from the previous one. */
export interface GitSnapshot {
  branch: string;
  ahead: number | null;
  behind: number | null;
  /** Uncommitted paths (first 20). */
  changed: string[];
  changedCount: number;
  /** Commits made after `since` (up to 10), newest first. */
  commitsSince: { hash: string; subject: string; at: number }[];
  lastCommit?: { hash: string; subject: string; at: number };
}

const MAX_CHANGED = 20;
/**
 * Read-only for real: --no-optional-locks keeps `git status` from taking index.lock (which would
 * race with the agent's own git add/commit); core.fsmonitor=false never runs a repo-configured hook.
 */
const GIT_SAFE = ["--no-optional-locks", "-c", "core.quotepath=off", "-c", "core.fsmonitor=false"];
const MAX_COMMITS = 10;

function run(dir: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", GIT_SAFE.concat(args), { cwd: dir, timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });
}

/** Current branch name; "-" when the folder is not a git work tree (or git is missing). */
export function currentBranch(dir: string): string {
  const r = spawnSync("git", GIT_SAFE.concat(["rev-parse", "--abbrev-ref", "HEAD"]), { cwd: dir, encoding: "utf8", timeout: 2000, windowsHide: true });
  const name = r.status === 0 ? r.stdout.trim() : "";
  return name && name !== "HEAD" ? name : name === "HEAD" ? "detached" : "-";
}

const parseLog = (out: string) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, at, ...subject] = line.split("\x1f");
      return { hash, at: Number(at) * 1000, subject: subject.join("\x1f") };
    });

/** Read-only snapshot of the work tree. Never throws: any failure or timeout gives null. */
export async function gitSnapshot(dir: string, since?: number, opts: { timeoutMs?: number } = {}): Promise<GitSnapshot | null> {
  const timeout = opts.timeoutMs ?? 2000;
  const status = await run(dir, ["status", "--porcelain=v1", "-b", "--untracked-files=all"], timeout);
  if (status === null) return null;
  const lines = status.split("\n").filter(Boolean);
  const head = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  const branch = (head.split("...")[0] || "-").replace(/^No commits yet on /, "").trim() || "-";
  const ahead = /ahead (\d+)/.exec(head);
  const behind = /behind (\d+)/.exec(head);
  const tracking = head.includes("...");
  const paths = lines.map((l) => {
    const p = l.slice(3);
    const renamed = p.split(" -> ");
    return (renamed[1] ?? renamed[0]).replace(/^"(.*)"$/, "$1");
  });

  const format = "--format=%h\x1f%ct\x1f%s";
  const [recent, last] = await Promise.all([
    since !== undefined ? run(dir, ["log", `-${MAX_COMMITS}`, `--since=@${Math.floor(since / 1000)}`, format], timeout) : Promise.resolve(null),
    run(dir, ["log", "-1", format], timeout),
  ]);
  const lastCommit = last ? parseLog(last)[0] : undefined;
  return {
    branch,
    ahead: tracking ? Number(ahead?.[1] ?? 0) : null,
    behind: tracking ? Number(behind?.[1] ?? 0) : null,
    changed: paths.slice(0, MAX_CHANGED),
    changedCount: paths.length,
    commitsSince: recent ? parseLog(recent).filter((c) => c.at > (since ?? 0)) : [],
    ...(lastCommit ? { lastCommit } : {}),
  };
}
