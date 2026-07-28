import fs from "node:fs";
import path from "node:path";
import { getDb, utcnow } from "../db/schema.js";
import { OUTPUT_DIR, UPLOADS_DIR, PUBLIC_BASE_URL } from "../config.js";
import {
  composeSourceM3uUrl,
  resolveM3uUrls,
  customM3uUrls,
  m3uUrlForCountry,
} from "./iptvorg.js";
import * as settings from "./settings.js";

export const SOURCE_MODE_KEYS = ["iptvorg", "urls", "uploads"];

export function parseSourceModes(raw) {
  const parts = String(raw || "")
    .split(/[,\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => SOURCE_MODE_KEYS.includes(p));
  return new Set(parts.length ? parts : ["iptvorg"]);
}

export function serializeSourceModes(modes) {
  const set = modes instanceof Set ? modes : parseSourceModes(modes);
  const ordered = SOURCE_MODE_KEYS.filter((k) => set.has(k));
  return ordered.length ? ordered.join(",") : "iptvorg";
}

export function slugify(v) {
  return (
    String(v || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "playlist"
  );
}

export function getPlaylist(id) {
  return getDb().prepare("SELECT * FROM playlists WHERE id = ?").get(id) || null;
}

export function listPlaylists(userId = null, isAdmin = false) {
  // Incomplete wizard drafts stay off the dashboard until Generate finishes
  if (isAdmin) {
    return getDb()
      .prepare(
        `SELECT p.*, u.username FROM playlists p
         JOIN users u ON u.id = p.user_id
         WHERE p.setup_complete = 1
         ORDER BY p.updated_at DESC`
      )
      .all();
  }
  return getDb()
    .prepare(
      `SELECT p.*, u.username FROM playlists p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ? AND p.setup_complete = 1
       ORDER BY p.updated_at DESC`
    )
    .all(userId);
}

export function listEnabledPlaylists() {
  return getDb()
    .prepare(
      "SELECT * FROM playlists WHERE enabled = 1 AND setup_complete = 1 ORDER BY id"
    )
    .all();
}

export function listEnabledPlaylistsForUser(userId) {
  return getDb()
    .prepare(
      "SELECT * FROM playlists WHERE enabled = 1 AND setup_complete = 1 AND user_id = ? ORDER BY id"
    )
    .all(userId);
}

/** In-progress wizard playlist (hidden from dashboard until Generate). */
export function findIncompletePlaylist(userId) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM playlists
         WHERE user_id = ? AND setup_complete = 0
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(userId) || null
  );
}

export function markPlaylistSetupComplete(id) {
  return updatePlaylist(id, { setup_complete: 1 });
}

export function createPlaylist(userId, data) {
  const name = (data.name || "").trim();
  const slug = slugify(data.slug || name);
  const countries = (data.countries || "").trim();
  const custom = customM3uUrls(data.source_m3u_url || "").join("\n");
  const modes = serializeSourceModes(data.source_modes || "iptvorg");
  const modeSet = parseSourceModes(modes);
  const source = composeSourceM3uUrl(
    modeSet.has("iptvorg") ? countries : "",
    modeSet.has("urls") ? custom : ""
  );
  const now = utcnow();
  const setupComplete = data.setup_complete == null ? 1 : data.setup_complete ? 1 : 0;
  const info = getDb()
    .prepare(
      `INSERT INTO playlists (
        user_id, name, slug, source_m3u_url, countries, source_modes, channel_names,
        match_mode, prefer_quality, include_all_matches, quality_filter,
        dedupe_by_name, epg_url, epg_category, epg_match_csv_url,
        align_tvg_ids, m3u_include_epg, enabled, setup_complete, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      name,
      slug,
      source,
      countries,
      modes,
      data.channel_names || "",
      data.match_mode || "smart",
      data.prefer_quality || "best",
      data.include_all_matches ? 1 : 0,
      data.quality_filter ?? "",
      data.dedupe_by_name == null ? 1 : data.dedupe_by_name ? 1 : 0,
      data.epg_url || "",
      data.epg_category || "US",
      data.epg_match_csv_url || "",
      data.align_tvg_ids ? 1 : 0,
      data.m3u_include_epg == null ? 1 : data.m3u_include_epg ? 1 : 0,
      data.enabled == null ? 1 : data.enabled ? 1 : 0,
      setupComplete,
      now,
      now
    );
  return getPlaylist(info.lastInsertRowid);
}

export function updatePlaylist(id, updates) {
  const pl = getPlaylist(id);
  if (!pl) return null;

  if ("source_modes" in updates) {
    updates.source_modes = serializeSourceModes(updates.source_modes);
  }

  if (
    "countries" in updates ||
    "source_m3u_url" in updates ||
    "source_modes" in updates
  ) {
    const modes = parseSourceModes(
      updates.source_modes != null ? updates.source_modes : pl.source_modes
    );
    const countries =
      updates.countries != null ? updates.countries : pl.countries;
    const customText =
      updates.source_m3u_url != null
        ? customM3uUrls(updates.source_m3u_url).join("\n")
        : customM3uUrls(pl.source_m3u_url).join("\n");
    updates.source_m3u_url = composeSourceM3uUrl(
      modes.has("iptvorg") ? countries : "",
      // Always keep pasted custom URLs in storage; source_modes controls whether
      // they are used. Clearing them only happens when the URLs field is saved empty.
      customText
    );
    updates.countries = String(countries || "").trim();
    if (!("source_modes" in updates)) {
      updates.source_modes = serializeSourceModes(modes);
    }
  }
  if ("name" in updates && !("slug" in updates)) {
    updates.slug = slugify(updates.name);
  }
  if ("slug" in updates) updates.slug = slugify(updates.slug);

  const bools = [
    "include_all_matches",
    "dedupe_by_name",
    "align_tvg_ids",
    "m3u_include_epg",
    "enabled",
    "setup_complete",
  ];
  for (const b of bools) {
    if (b in updates) updates[b] = updates[b] ? 1 : 0;
  }

  const allowed = [
    "name",
    "slug",
    "source_m3u_url",
    "countries",
    "source_modes",
    "channel_names",
    "match_mode",
    "prefer_quality",
    "include_all_matches",
    "quality_filter",
    "dedupe_by_name",
    "epg_url",
    "epg_upload_path",
    "epg_category",
    "epg_match_csv_url",
    "align_tvg_ids",
    "m3u_include_epg",
    "enabled",
    "setup_complete",
    "refresh_timezone",
    "refresh_time",
    "refresh_days",
    "refresh_interval_hours",
    "refresh_last_daily_stamp",
    "refresh_last_interval_at",
    "last_generated_at",
    "last_status",
    "last_error",
    "matched_count",
    "missing_count",
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in updates) {
      sets.push(`${k} = ?`);
      vals.push(updates[k]);
    }
  }
  if (!sets.length) return pl;
  sets.push("updated_at = ?");
  vals.push(utcnow(), id);
  getDb()
    .prepare(`UPDATE playlists SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
  if (
    "countries" in updates ||
    "source_m3u_url" in updates ||
    "source_modes" in updates
  ) {
    invalidateSourceMemCache(id);
  }
  return getPlaylist(id);
}

export function deletePlaylist(id, { vacuum = true } = {}) {
  const pid = Number(id);
  const pl = getPlaylist(pid);
  const db = getDb();

  // Explicit child cleanup (do not rely only on FK cascade)
  db.prepare("DELETE FROM playlist_channel_stash WHERE playlist_id = ?").run(pid);
  db.prepare("DELETE FROM playlist_channels WHERE playlist_id = ?").run(pid);

  if (pl) {
    const uploadDir = path.join(UPLOADS_DIR, String(pl.id));
    const resolvedUpload = path.resolve(uploadDir);
    if (
      fs.existsSync(resolvedUpload) &&
      resolvedUpload.startsWith(path.resolve(UPLOADS_DIR))
    ) {
      fs.rmSync(resolvedUpload, { recursive: true, force: true });
    }
    const user = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(pl.user_id);
    if (user?.username && pl.slug) {
      const outDir = path.join(
        OUTPUT_DIR,
        String(user.username).toLowerCase(),
        pl.slug
      );
      const resolvedOut = path.resolve(outDir);
      if (
        fs.existsSync(resolvedOut) &&
        resolvedOut.startsWith(path.resolve(OUTPUT_DIR))
      ) {
        fs.rmSync(resolvedOut, { recursive: true, force: true });
      }
      // Remove empty username output folder
      const userOut = path.join(OUTPUT_DIR, String(user.username).toLowerCase());
      try {
        if (fs.existsSync(userOut) && fs.readdirSync(userOut).length === 0) {
          fs.rmdirSync(userOut);
        }
      } catch {
        /* ignore */
      }
    }
  }

  db.prepare("DELETE FROM playlists WHERE id = ?").run(pid);
  invalidateSourceMemCache(pid);
  if (vacuum) cleanupOrphanPlaylistData({ vacuum: true });
  else cleanupOrphanPlaylistData({ vacuum: false });
}

/**
 * Remove orphaned channel/stash rows and upload/output folders that no longer
 * belong to any playlist. Optionally VACUUM to shrink iptv.db.
 */
export function cleanupOrphanPlaylistData({ vacuum = false } = {}) {
  const db = getDb();
  db.exec(`
    DELETE FROM playlist_channels
      WHERE playlist_id NOT IN (SELECT id FROM playlists);
    DELETE FROM playlist_channel_stash
      WHERE playlist_id NOT IN (SELECT id FROM playlists);
    DELETE FROM user_settings
      WHERE user_id NOT IN (SELECT id FROM users);
  `);

  const liveIds = new Set(
    db.prepare("SELECT id FROM playlists").all().map((r) => String(r.id))
  );
  if (fs.existsSync(UPLOADS_DIR)) {
    for (const name of fs.readdirSync(UPLOADS_DIR)) {
      if (!/^\d+$/.test(name)) continue;
      if (liveIds.has(name)) continue;
      const dir = path.resolve(path.join(UPLOADS_DIR, name));
      if (!dir.startsWith(path.resolve(UPLOADS_DIR))) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const liveOut = new Set(
    db
      .prepare(
        `SELECT lower(u.username) || '/' || lower(p.slug) AS k
         FROM playlists p
         JOIN users u ON u.id = p.user_id`
      )
      .all()
      .map((r) => r.k)
  );
  if (fs.existsSync(OUTPUT_DIR)) {
    const root = path.resolve(OUTPUT_DIR);
    for (const userDir of fs.readdirSync(OUTPUT_DIR)) {
      const userPath = path.join(OUTPUT_DIR, userDir);
      if (!fs.statSync(userPath).isDirectory()) continue;
      for (const slug of fs.readdirSync(userPath)) {
        const key = `${String(userDir).toLowerCase()}/${String(slug).toLowerCase()}`;
        if (liveOut.has(key)) continue;
        const slugPath = path.resolve(path.join(userPath, slug));
        if (!slugPath.startsWith(root)) continue;
        fs.rmSync(slugPath, { recursive: true, force: true });
      }
      try {
        if (fs.readdirSync(userPath).length === 0) fs.rmdirSync(userPath);
      } catch {
        /* ignore */
      }
    }
  }

  if (vacuum) {
    try {
      db.exec("PRAGMA optimize");
      db.exec("VACUUM");
    } catch {
      /* ignore — VACUUM may fail if another connection is busy */
    }
  }
}

export function canAccessPlaylist(pl, user) {
  if (!pl || !user) return false;
  return pl.user_id === user.id || user.is_admin;
}

/** First value from a possibly comma-separated forwarded header. */
function firstForwarded(value) {
  if (value == null || value === "") return "";
  return String(Array.isArray(value) ? value[0] : value)
    .split(",")[0]
    .trim();
}

/**
 * Build the public site origin for copyable playlist URLs.
 * Prefer the current request (Host + X-Forwarded-*) so local IP (http)
 * and a public domain behind Nginx Proxy Manager (https) both work.
 * Configured PUBLIC_BASE_URL / settings are only a fallback when there is no request.
 */
export function resolvePublicBase(req = null) {
  if (req) {
    const host =
      firstForwarded(req.headers?.["x-forwarded-host"]) ||
      firstForwarded(req.headers?.host);
    if (host) {
      const proto =
        firstForwarded(req.headers?.["x-forwarded-proto"]) ||
        req.protocol ||
        "http";
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }
  return (
    settings.getSetting("public_base_url") ||
    PUBLIC_BASE_URL ||
    ""
  ).replace(/\/$/, "");
}

export function publicUrls(username, slug, baseOverride = null) {
  const base = (
    baseOverride != null
      ? baseOverride
      : settings.getSetting("public_base_url") || PUBLIC_BASE_URL || ""
  ).replace(/\/$/, "");
  const pathBase = `/u/${username.toLowerCase()}/${slug}`;
  const abs = (p) => (base ? `${base}${p}` : p);
  return {
    playlist: abs(`${pathBase}/playlist.m3u`),
    epg: abs(`${pathBase}/epg.xml.gz`),
    epgFile: (name) => abs(`${pathBase}/epg/${encodeURIComponent(name)}`),
  };
}

export function outputPaths(username, slug) {
  const folder = path.join(OUTPUT_DIR, username.toLowerCase(), slug);
  fs.mkdirSync(folder, { recursive: true });
  return {
    folder,
    m3u: path.join(folder, "playlist.m3u"),
    epgGz: path.join(folder, "epg.xml.gz"),
  };
}

export function uploadsDir(playlistId) {
  const d = path.join(UPLOADS_DIR, String(playlistId));
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(d, "m3u"), { recursive: true });
  return d;
}

/** Pre-create uploads while Name/Source/Guide live only in the session. */
export function draftUploadsDir(userId) {
  const d = path.join(UPLOADS_DIR, `draft-u${userId}`);
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(d, "m3u"), { recursive: true });
  return d;
}

export function listDraftUploadedM3u(userId) {
  const dir = path.join(draftUploadsDir(userId), "m3u");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(m3u8?|txt)$/i.test(f) && !f.endsWith(".tmp"))
    .sort();
}

export function clearDraftUploads(userId) {
  const d = path.join(UPLOADS_DIR, `draft-u${userId}`);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/** Move session-draft M3U files into the new playlist upload folder. */
export function moveDraftUploadsToPlaylist(userId, playlistId) {
  const from = path.join(UPLOADS_DIR, `draft-u${userId}`, "m3u");
  if (!fs.existsSync(from)) return 0;
  const to = path.join(uploadsDir(playlistId), "m3u");
  let n = 0;
  for (const name of fs.readdirSync(from)) {
    if (!/\.(m3u8?|txt)$/i.test(name) || name.endsWith(".tmp")) continue;
    const src = path.join(from, name);
    let dest = path.join(to, name);
    if (fs.existsSync(dest)) {
      const stem = path.parse(name).name;
      const ext = path.parse(name).ext;
      dest = path.join(to, `${stem}-${Date.now()}${ext}`);
    }
    fs.renameSync(src, dest);
    n += 1;
  }
  clearDraftUploads(userId);
  return n;
}

export function listUploadedM3u(playlistId) {
  const dir = path.join(uploadsDir(playlistId), "m3u");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(m3u8?|txt)$/i.test(f) && !f.endsWith(".tmp"))
    .sort();
}

/** Normalize EPG URL field: newlines → commas, trim empties */
export function normalizeEpgUrls(text) {
  return String(text || "")
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .join(",");
}

/**
 * Build ordered source refs for a playlist from its modes.
 * Combinations:
 *  iptvorg | urls | uploads | any pair | all three
 * Country M3U URLs in the URL field are kept unless that same country
 * is already selected under iptv-org (avoids double-fetch only).
 */
export function buildSourceRefs(pl) {
  const modes = parseSourceModes(pl.source_modes);
  const refs = [];
  const uploaded = listUploadedM3u(pl.id);

  let codes = [];
  if (modes.has("iptvorg")) {
    codes = String(pl.countries || "")
      .split(/\s+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    if (!codes.length) codes = ["US"];
    for (const code of codes) refs.push(m3uUrlForCountry(code));
  }

  if (modes.has("urls")) {
    const already = new Set(
      codes.map((c) => m3uUrlForCountry(c).toLowerCase())
    );
    for (const u of customM3uUrls(pl.source_m3u_url)) {
      if (already.has(String(u).toLowerCase())) continue;
      refs.push(u);
    }
  }

  if (modes.has("uploads")) {
    for (const f of uploaded) refs.push(`local://m3u/${f}`);
  }

  // Legacy fallback only when modes produced nothing
  if (!refs.length) {
    for (const u of resolveM3uUrls(pl)) refs.push(u);
    for (const f of uploaded) refs.push(`local://m3u/${f}`);
  }

  // Dedupe refs (same URL listed twice)
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const key = String(r).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const sourceMemCache = new Map();
const SOURCE_MEM_TTL_MS = 90_000;

export function invalidateSourceMemCache(playlistId) {
  if (playlistId == null) sourceMemCache.clear();
  else sourceMemCache.delete(Number(playlistId));
}

export async function loadSourceChannels(pl, { force = false } = {}) {
  const id = Number(pl?.id);
  if (!force && id) {
    const hit = sourceMemCache.get(id);
    if (hit && Date.now() - hit.at < SOURCE_MEM_TTL_MS) {
      return hit.channels;
    }
  }

  const refs = buildSourceRefs(pl);
  const { parseM3uFromFile } = await import("./m3u.js");
  const { fetchUrlCached, ensureLocalCached } = await import("./cache.js");
  const all = [];
  const seenUrl = new Set();
  const errors = [];

  for (const ref of refs) {
    try {
      let fp = "";
      if (ref.startsWith("local://")) {
        const rel = ref.slice("local://".length);
        const local = path.join(uploadsDir(pl.id), rel);
        if (!fs.existsSync(local)) {
          errors.push(`Missing upload: ${rel}`);
          continue;
        }
        fp = ensureLocalCached(local);
      } else {
        fp = await fetchUrlCached(ref);
      }
      for (const ch of await parseM3uFromFile(fp)) {
        const url = String(ch.url || "").trim();
        if (url) {
          if (seenUrl.has(url)) continue;
          seenUrl.add(url);
        }
        all.push(ch);
      }
    } catch (e) {
      errors.push(`${ref}: ${e.message || e}`);
    }
  }

  if (!all.length && errors.length) {
    const err = new Error(errors.slice(0, 3).join("; "));
    err.sourceErrors = errors;
    throw err;
  }
  if (errors.length) {
    all._sourceErrors = errors;
  }
  if (id) sourceMemCache.set(id, { at: Date.now(), channels: all });
  return all;
}

export { resolveM3uUrls, customM3uUrls, composeSourceM3uUrl };
