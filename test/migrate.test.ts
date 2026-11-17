import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
import { ContextStore } from "../src/store.js";
import { SCHEMA_VERSION, V1_SCHEMA, migrate } from "../src/migrate.js";

const tempDb = () => join(mkdtempSync(join(tmpdir(), "baglam-mig-")), "baglam.db");

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

describe("schema migrations", () => {
  it("fresh in-memory db ends at SCHEMA_VERSION", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrate(db, ":memory:")).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(userVersion(db)).toBe(2);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["entries", "projects", "events", "trust_rules"]));
  });

  it("migrates a v0.1 file and keeps a backup", () => {
    const path = tempDb();
    const old = new DatabaseSync(path);
    old.exec(V1_SCHEMA);
    old.prepare(
      `INSERT INTO entries (id, project, kind, title, body, status, source_agent, created_at)
       VALUES ('cold1', 'c:/p', 'decision', 'Use pnpm', 'b', 'approved', 'claude-code', 1)`,
    ).run();
    old.close();

    const store = new ContextStore(path);
    const e = store.get("cold1");
    expect(e?.title).toBe("Use pnpm");
    expect(e?.editedAt).toBeNull();
    expect(e?.autoApproved).toBe(false);
    store.close();

    const db = new DatabaseSync(path);
    expect(userVersion(db)).toBe(2);
    db.close();
    expect(existsSync(path + ".v1-backup")).toBe(true);
  });

  it("is idempotent", () => {
    const path = tempDb();
    new ContextStore(path).close();
    const db = new DatabaseSync(path);
    expect(migrate(db, path)).toEqual({ from: 2, to: 2 });
    db.close();
    expect(readdirSync(join(path, "..")).filter((f) => f.includes("backup"))).toEqual([]);
  });

  it("several processes opening a v0.1 file at once all succeed", async () => {
    execSync("npm run build", { cwd: root, stdio: "ignore" });
    const path = tempDb();
    const old = new DatabaseSync(path);
    old.exec("PRAGMA journal_mode = WAL");
    old.exec(V1_SCHEMA);
    old.prepare(
      `INSERT INTO entries (id, project, kind, title, body, status, source_agent, created_at)
       VALUES ('cold1', 'c:/p', 'decision', 'Use pnpm', 'b', 'approved', 'claude-code', 1)`,
    ).run();
    old.close();

    const storeUrl = pathToFileURL(join(root, "dist", "store.js")).href;
    const script = `import { ContextStore } from ${JSON.stringify(storeUrl)}; new ContextStore(${JSON.stringify(path)}).close();`;
    const run = () =>
      new Promise<string>((done) => {
        execFile(process.execPath, ["--input-type=module", "-e", script], (err, _out, stderr) =>
          done(err ? stderr.split("\n").find((l) => /Error/.test(l)) ?? String(err) : "ok"),
        );
      });
    const results = await Promise.all(Array.from({ length: 8 }, run));
    expect(results).toEqual(Array(8).fill("ok"));

    const store = new ContextStore(path);
    expect(store.get("cold1")?.title).toBe("Use pnpm");
    store.close();
    const backup = new DatabaseSync(path + ".v1-backup");
    expect((backup.prepare("SELECT title FROM entries WHERE id='cold1'").get() as { title: string }).title).toBe("Use pnpm");
    backup.close();
  }, 60_000);

  it("refuses a newer schema", () => {
    const path = tempDb();
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version = 99");
    db.close();
    expect(() => new ContextStore(path)).toThrow(/newer version of Bağlam/);
  });
});
