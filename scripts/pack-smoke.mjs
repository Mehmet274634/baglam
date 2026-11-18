#!/usr/bin/env node
// Packs Bağlam exactly as npm would publish it, installs the tarball into a temp prefix whose path
// contains a space, and runs the installed CLI and MCP server. Nothing is published.
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const win = process.platform === "win32";
const npm = win ? "npm.cmd" : "npm";
const work = mkdtempSync(join(tmpdir(), "baglam smoke "));
const prefix = join(work, "global prefix");
const home = join(work, "home");
mkdirSync(home, { recursive: true });

// npm is a .cmd on Windows and needs a shell there; quote every argument for it.
const q = (a) => (win ? `"${a}"` : a);
const npmRun = (args, opts = {}) =>
  win
    ? execSync([npm, ...args.map(q)].join(" "), { stdio: "ignore", ...opts })
    : execFileSync(npm, args, { stdio: "ignore", ...opts });

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

try {
  npmRun(["pack", "--pack-destination", work], { cwd: root });
  const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
  check("npm pack produced a tarball", !!tarball, tarball);

  npmRun(["install", "-g", "--prefix", prefix, join(work, tarball)]);
  const pkgDir = win ? join(prefix, "node_modules", "baglam") : join(prefix, "lib", "node_modules", "baglam");
  const cli = join(pkgDir, "dist", "cli.js");
  check("installed CLI exists", existsSync(cli), cli);
  check("panel assets are packaged", existsSync(join(pkgDir, "dist", "panel", "index.html")));
  check("bin shim exists", existsSync(win ? join(prefix, "baglam.cmd") : join(prefix, "bin", "baglam")));

  const env = { ...process.env, HOME: home, USERPROFILE: home, BAGLAM_DB: join(work, "data", "baglam.db") };
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd: home });

  const help = run("--help");
  check("baglam --help", help.status === 0 && /Usage: baglam/.test(help.stdout));
  const version = run("--version");
  check("baglam --version", version.status === 0 && /^\d+\.\d+\.\d+/.test(version.stdout.trim()), version.stdout.trim());
  const doctor = run("doctor");
  check("baglam doctor runs", /Node\.js/.test(doctor.stdout) && /Database/.test(doctor.stdout), `exit ${doctor.status}`);
  check("doctor did not create the database", !existsSync(env.BAGLAM_DB));

  // The automatic-saving hook ships too, answers at once and leaves folders without a project alone.
  const hook = spawnSync(process.execPath, [join(pkgDir, "dist", "hook.js"), "cursor", "prompt"], {
    encoding: "utf8", env, cwd: home, input: JSON.stringify({ prompt: "x", workspace_roots: [home] }),
  });
  check("packaged hook answers", hook.status === 0 && hook.stdout === '{"continue":true}', `exit ${hook.status}, ${JSON.stringify(hook.stdout)}`);
  check("hook outside a project wrote nothing", !existsSync(env.BAGLAM_DB));

  const sdk = (p) => pathToFileURL(join(root, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", p)).href;
  const { Client } = await import(sdk("client/index.js"));
  const { StdioClientTransport } = await import(sdk("client/stdio.js"));
  const client = new Client({ name: "smoke", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], env: { ...env, BAGLAM_PROJECT: work }, stderr: "ignore" }),
  );
  const { tools } = await client.listTools();
  check("packaged MCP server answers", tools.some((t) => t.name === "context_checkpoint") && tools.length === 6, tools.map((t) => t.name).join(", "));
  await client.close();
} catch (err) {
  check("smoke run", false, err.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nPackaged install works.");
process.exit(failed ? 1 : 0);
