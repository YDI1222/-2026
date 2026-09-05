import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/**
 * 依存パッケージゼロで動かすため Node 22 標準の node:sqlite を使う。
 * 本番で Postgres 等に載せ替える場合は、このファイルと repo.ts の
 * クエリだけを差し替えれば済むようにしている（他の層は SQL を知らない）。
 */

const DEFAULT_DIR = "data";
const DEFAULT_FILE = "sukima.sqlite";

declare global {
  // eslint-disable-next-line no-var
  var __sukimaDb: DatabaseSync | undefined;
}

/** DATABASE_FILE は絶対パスでも、プロジェクト相対でも受ける。 */
function resolveDbPath(): string {
  const configured = process.env.DATABASE_FILE;
  if (!configured) return join(process.cwd(), DEFAULT_DIR, DEFAULT_FILE);
  // 実行時にしか決まらないパスなので、ビルド時のファイルトレースからは外す。
  return isAbsolute(configured) ? configured : join(/* turbopackIgnore: true */ process.cwd(), configured);
}

function open(): DatabaseSync {
  const file = resolveDbPath();
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** 開発中の HMR で接続が増え続けないよう global にキャッシュする。 */
export function getDb(): DatabaseSync {
  if (!globalThis.__sukimaDb) globalThis.__sukimaDb = open();
  return globalThis.__sukimaDb;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      google_sub    TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL,
      name          TEXT NOT NULL DEFAULT '',
      picture       TEXT,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    INTEGER NOT NULL DEFAULT 0,
      scope         TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polls (
      id                 TEXT PRIMARY KEY,
      admin_token        TEXT NOT NULL,
      account_id         TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      title              TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      organizer_name     TEXT NOT NULL DEFAULT '',
      organizer_email    TEXT,
      timezone           TEXT NOT NULL DEFAULT 'Asia/Tokyo',
      duration_minutes   INTEGER NOT NULL DEFAULT 60,
      location_mode      TEXT NOT NULL DEFAULT 'online',
      online_provider    TEXT NOT NULL DEFAULT 'google_meet',
      custom_meeting_url TEXT,
      offline_place      TEXT,
      status             TEXT NOT NULL DEFAULT 'open',
      confirmed_slot_id  TEXT,
      google_event_id    TEXT,
      google_event_link  TEXT,
      meeting_url        TEXT,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slots (
      id         TEXT PRIMARY KEY,
      poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      starts_at  INTEGER NOT NULL,
      ends_at    INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_slots_poll ON slots(poll_id, sort_order);

    CREATE TABLE IF NOT EXISTS participants (
      id         TEXT PRIMARY KEY,
      poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      edit_token TEXT NOT NULL,
      name       TEXT NOT NULL,
      comment    TEXT NOT NULL DEFAULT '',
      email      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_participants_poll ON participants(poll_id, created_at);

    CREATE TABLE IF NOT EXISTS votes (
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      slot_id        TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
      answer         TEXT NOT NULL,
      PRIMARY KEY (participant_id, slot_id)
    );

    CREATE TABLE IF NOT EXISTS share_targets (
      id         TEXT PRIMARY KEY,
      poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      channel    TEXT NOT NULL,
      target     TEXT NOT NULL,
      label      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_share_targets_poll ON share_targets(poll_id);
  `);
}
