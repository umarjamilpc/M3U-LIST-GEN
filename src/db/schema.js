import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../config.js";

let _db;

export function utcnow() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  // WAL + NORMAL is durable across process/OS reboot; checkpoint on close
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA synchronous = NORMAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");
  return _db;
}

export function closeDb() {
  if (!_db) return;
  try {
    _db.close();
  } catch {
    /* ignore */
  }
  _db = null;
}

export function initDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      source_m3u_url TEXT NOT NULL DEFAULT '',
      countries TEXT NOT NULL DEFAULT '',
      channel_names TEXT NOT NULL DEFAULT '',
      match_mode TEXT NOT NULL DEFAULT 'smart',
      prefer_quality TEXT NOT NULL DEFAULT 'best',
      include_all_matches INTEGER NOT NULL DEFAULT 0,
      quality_filter TEXT NOT NULL DEFAULT '',
      dedupe_by_name INTEGER NOT NULL DEFAULT 1,
      epg_url TEXT NOT NULL DEFAULT '',
      epg_upload_path TEXT NOT NULL DEFAULT '',
      epg_category TEXT NOT NULL DEFAULT 'US',
      epg_match_csv_url TEXT NOT NULL DEFAULT '',
      align_tvg_ids INTEGER NOT NULL DEFAULT 0,
      m3u_include_epg INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_generated_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'never',
      last_error TEXT NOT NULL DEFAULT '',
      matched_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, slug),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlist_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      requested_name TEXT NOT NULL DEFAULT '',
      source_tvg_id TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      source_logo TEXT NOT NULL DEFAULT '',
      source_group TEXT NOT NULL DEFAULT '',
      custom_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Other',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(playlist_id, position),
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlist_channel_stash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      tvg_id TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      logo TEXT NOT NULL DEFAULT '',
      group_title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Other',
      quality TEXT NOT NULL DEFAULT 'other',
      created_at TEXT NOT NULL,
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
    CREATE INDEX IF NOT EXISTS idx_playlists_slug ON playlists(slug);
    CREATE INDEX IF NOT EXISTS idx_pl_channels_playlist
      ON playlist_channels(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_pl_channels_tvg
      ON playlist_channels(playlist_id, source_tvg_id);
    CREATE INDEX IF NOT EXISTS idx_pl_stash_playlist
      ON playlist_channel_stash(playlist_id);
  `);
  migratePlaylists(db);
  // Drop leftover DB rows from deleted playlists (files cleaned on delete + startup)
  db.exec(`
    DELETE FROM playlist_channels
      WHERE playlist_id NOT IN (SELECT id FROM playlists);
    DELETE FROM playlist_channel_stash
      WHERE playlist_id NOT IN (SELECT id FROM playlists);
    DELETE FROM user_settings
      WHERE user_id NOT IN (SELECT id FROM users);
  `);
  return db;
}

function columnExists(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function migratePlaylists(db) {
  if (!columnExists(db, "playlists", "source_modes")) {
    db.exec(
      `ALTER TABLE playlists ADD COLUMN source_modes TEXT NOT NULL DEFAULT 'iptvorg'`
    );
    const rows = db
      .prepare("SELECT id, countries, source_m3u_url FROM playlists")
      .all();
    const upd = db.prepare("UPDATE playlists SET source_modes = ? WHERE id = ?");
    for (const pl of rows) {
      const modes = [];
      if (String(pl.countries || "").trim()) modes.push("iptvorg");
      const hasCustom = String(pl.source_m3u_url || "")
        .split(/\r?\n/)
        .some(
          (l) =>
            l.trim() &&
            !/iptv-org\.github\.io\/iptv\/countries\//i.test(l) &&
            !l.trim().startsWith("local://")
        );
      if (hasCustom) modes.push("urls");
      if (!modes.length) modes.push("iptvorg");
      upd.run(modes.join(","), pl.id);
    }
  }

  // Existing playlists are complete; new wizard drafts start at 0 until Generate
  if (!columnExists(db, "playlists", "setup_complete")) {
    db.exec(
      `ALTER TABLE playlists ADD COLUMN setup_complete INTEGER NOT NULL DEFAULT 1`
    );
  }

  const refreshCols = [
    ["refresh_timezone", "TEXT NOT NULL DEFAULT 'UTC'"],
    ["refresh_time", "TEXT NOT NULL DEFAULT '04:00'"],
    ["refresh_days", "TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6'"],
    ["refresh_interval_hours", "TEXT NOT NULL DEFAULT '0'"],
    ["refresh_last_daily_stamp", "TEXT NOT NULL DEFAULT ''"],
    ["refresh_last_interval_at", "TEXT NOT NULL DEFAULT ''"],
  ];
  let addedRefresh = false;
  for (const [col, decl] of refreshCols) {
    if (!columnExists(db, "playlists", col)) {
      db.exec(`ALTER TABLE playlists ADD COLUMN ${col} ${decl}`);
      addedRefresh = true;
    }
  }
  // One-time: copy prior per-user refresh prefs onto each playlist
  if (addedRefresh) {
    const getPref = db.prepare(
      "SELECT value FROM user_settings WHERE user_id = ? AND key = ?"
    );
    const upd = db.prepare(
      `UPDATE playlists SET
         refresh_timezone = ?,
         refresh_time = ?,
         refresh_days = ?,
         refresh_interval_hours = ?
       WHERE user_id = ?`
    );
    const userIds = db
      .prepare("SELECT DISTINCT user_id FROM playlists")
      .all()
      .map((r) => r.user_id);
    for (const uid of userIds) {
      const pref = (key, fallback) => getPref.get(uid, key)?.value ?? fallback;
      upd.run(
        pref("refresh_timezone", "UTC"),
        pref("refresh_time", "04:00"),
        pref("refresh_days", "0,1,2,3,4,5,6"),
        pref("refresh_interval_hours", "0"),
        uid
      );
    }
  }

  migrateChannelStash(db);
}

function migrateChannelStash(db) {
  const cols = [
    ["channel_id", "INTEGER"],
    ["custom_name", "TEXT NOT NULL DEFAULT ''"],
    ["source_name", "TEXT NOT NULL DEFAULT ''"],
    ["requested_name", "TEXT NOT NULL DEFAULT ''"],
    ["position", "INTEGER"],
    ["enabled", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [col, decl] of cols) {
    if (!columnExists(db, "playlist_channel_stash", col)) {
      db.exec(`ALTER TABLE playlist_channel_stash ADD COLUMN ${col} ${decl}`);
    }
  }
}
