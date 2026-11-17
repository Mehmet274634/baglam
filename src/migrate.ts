import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

/** The v0.1 schema, exactly as shipped. Version 1. */
export const V1_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id            TEXT PRIMARY KEY,
  project       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  rationale     TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  audience      TEXT NOT NULL DEFAULT '["*"]',
  status        TEXT NOT NULL,
  source_agent  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    TEXT,
  decision_note TEXT,
  expires_at    INTEGER,
  supersedes    TEXT,
  superseded_by TEXT
);
CREATE INDEX IF NOT EXISTS entries_project_status ON entries(project, status);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, body, rationale, tags, content='entries', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, body, rationale, tags)
  VALUES (new.rowid, new.title, new.body, coalesce(new.rationale, ''), new.tags);
END;
CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, body, rationale, tags)
  VALUES ('delete', old.rowid, old.title, old.body, coalesce(old.rationale, ''), old.tags);
END;
CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF title, body, rationale, tags ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, body, rationale, tags)
  VALUES ('delete', old.rowid, old.title, old.body, coalesce(old.rationale, ''), old.tags);
  INSERT INTO entries_fts(rowid, title, body, rationale, tags)
  VALUES (new.rowid, new.title, new.body, coalesce(new.rationale, ''), new.tags);
END;
`;

const V2_SCHEMA = `
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  last_path   TEXT,
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE TABLE events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT,
  project  TEXT NOT NULL,
  type     TEXT NOT NULL,
  actor    TEXT NOT NULL,
  at       INTEGER NOT NULL,
  detail   TEXT
);
CREATE INDEX events_entry ON events(entry_id);
CREATE TABLE trust_rules (
  id         TEXT PRIMARY KEY,
  project_id TEXT,
  agent      TEXT,
  kind       TEXT,
  created_at INTEGER NOT NULL
);
ALTER TABLE entries ADD COLUMN edited_at INTEGER;
ALTER TABLE entries ADD COLUMN auto_approved INTEGER NOT NULL DEFAULT 0;
`;

const V3_SCHEMA = `
ALTER TABLE entries ADD COLUMN similar_to TEXT NOT NULL DEFAULT '[]';
`;

/** Index i upgrades the database from version i to version i + 1. */
const STEPS: ((db: DatabaseSync) => void)[] = [
  (db) => db.exec(V1_SCHEMA),
  (db) => db.exec(V2_SCHEMA),
  (db) => db.exec(V3_SCHEMA),
];

export const SCHEMA_VERSION = STEPS.length;

function currentVersion(db: DatabaseSync): number {
  const v = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (v > 0) return v;
  // v0.1 never set user_version; an existing entries table means version 1.
  const hasEntries = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entries'").get();
  return hasEntries ? 1 : 0;
}

/**
 * Bring the database to SCHEMA_VERSION. A file database that already holds data is
 * copied to `<path>.v<from>-backup` before it is changed.
 */
export function migrate(db: DatabaseSync, filePath: string): { from: number; to: number } {
  const seen = checkVersion(currentVersion(db));
  if (seen === SCHEMA_VERSION) return { from: seen, to: seen };

  // Consistent snapshot (includes WAL content) before anything changes. Several processes may get
  // here at once; the first one writes the backup, the others find it already there.
  const backup = `${filePath}.v${seen}-backup`;
  if (seen >= 1 && filePath !== ":memory:" && !existsSync(backup)) {
    try {
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    } catch (err) {
      if (!existsSync(backup)) throw err;
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // Re-read under the write lock: another process may have migrated while we waited.
    const from = checkVersion(currentVersion(db));
    for (let v = from; v < SCHEMA_VERSION; v++) STEPS[v](db);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
    return { from, to: SCHEMA_VERSION };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function checkVersion(v: number): number {
  if (v > SCHEMA_VERSION) {
    throw new Error(
      `This database was written by a newer version of Bağlam (schema ${v}, this version supports ${SCHEMA_VERSION}). Update Bağlam.`,
    );
  }
  return v;
}
