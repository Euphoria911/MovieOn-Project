import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const V1 = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('movie','series','anime')),
  name TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  year INTEGER,
  age_rating TEXT NOT NULL DEFAULT '12+',
  duration_min INTEGER,
  video_url TEXT,
  hue1 INTEGER NOT NULL DEFAULT 260,
  hue2 INTEGER NOT NULL DEFAULT 330,
  featured INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft')),
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_titles_type_status ON titles(type, status);
CREATE INDEX IF NOT EXISTS idx_titles_views ON titles(views);
CREATE INDEX IF NOT EXISTS idx_titles_created ON titles(created_at);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season INTEGER NOT NULL DEFAULT 1,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  duration_min INTEGER,
  video_url TEXT NOT NULL,
  UNIQUE (title_id, season, number)
);
CREATE INDEX IF NOT EXISTS idx_episodes_title ON episodes(title_id);

CREATE TABLE IF NOT EXISTS genres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS title_genres (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (title_id, genre_id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL DEFAULT 0,
  position_sec REAL NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, title_id, episode_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  PRIMARY KEY (user_id, title_id)
);
`;

const V2 = `
ALTER TABLE titles ADD COLUMN min_tier TEXT NOT NULL DEFAULT 'free'
  CHECK (min_tier IN ('free','silver','gold','diamond'));
ALTER TABLE titles ADD COLUMN rights_note TEXT NOT NULL DEFAULT '';

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('silver','gold','diamond')),
  status TEXT NOT NULL CHECK (status IN ('active','canceled')),
  started_at TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_user ON payments(user_id, id);

CREATE TABLE playback_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON playback_sessions(user_id, last_seen);
`;

/** Ordered migrations; the applied count is stored in PRAGMA user_version. */
export const MIGRATIONS = [V1, V2];

/** Open a SQLite database and apply any pending migrations. Use ':memory:' for tests. */
export function openDb(file = ':memory:') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  let version = db.pragma('user_version', { simple: true });
  // Databases created by v1.0 have user_version 0 but already contain the V1 schema
  // (it is idempotent), so they flow through V1 harmlessly and then get V2.
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.pragma(`user_version = ${version}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration to v${version + 1} failed: ${e.message}`);
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
