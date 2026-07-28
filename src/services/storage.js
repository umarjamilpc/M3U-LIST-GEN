import fs from "node:fs";
import path from "node:path";
import { OUTPUT_DIR, CACHE_DIR, UPLOADS_DIR, DB_PATH } from "../config.js";
import { listUsers } from "./auth.js";
import { listPlaylists } from "./playlists.js";

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function dirSize(dir, { filterName = null, relBase = dir } = {}) {
  let total = 0;
  const files = [];
  if (!fs.existsSync(dir)) return { total, files };
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else {
        if (filterName && !filterName(name, p)) continue;
        total += st.size;
        files.push({
          path: p,
          name,
          rel: path.relative(relBase, p).split(path.sep).join("/"),
          size: st.size,
          mtime: st.mtime.toISOString(),
          mtime_ms: st.mtimeMs,
        });
      }
    }
  };
  walk(dir);
  return { total, files };
}

function userOutputDir(username) {
  return path.join(OUTPUT_DIR, String(username || "").toLowerCase());
}

function playlistIdsForUser(userId, isAdmin) {
  return listPlaylists(userId, !!isAdmin)
    .filter((p) => (isAdmin ? true : p.user_id === userId))
    .map((p) => ({ id: p.id, name: p.name, slug: p.slug, username: p.username, user_id: p.user_id }));
}

function uploadsForPlaylists(playlists) {
  let total = 0;
  const files = [];
  for (const pl of playlists) {
    const dir = path.join(UPLOADS_DIR, String(pl.id));
    const sized = dirSize(dir, { relBase: UPLOADS_DIR });
    total += sized.total;
    for (const f of sized.files) {
      files.push({
        ...f,
        playlist_id: pl.id,
        playlist_name: pl.name,
        username: pl.username,
      });
    }
  }
  return { total, files };
}

/** Storage visible to a normal user (their M3U + their uploads only). */
export function getUserStorage(user) {
  const username = user.username;
  const outDir = userOutputDir(username);
  const m3u = dirSize(outDir, {
    filterName: (name) => name.endsWith(".m3u") || name.endsWith(".xml") || name.endsWith(".gz"),
    relBase: OUTPUT_DIR,
  });
  const playlists = playlistIdsForUser(user.id, false);
  const uploads = uploadsForPlaylists(playlists);
  return {
    scope: "user",
    username,
    totals: {
      generated_m3u: m3u.total,
      uploads: uploads.total,
      cache: 0,
      database: 0,
      all: m3u.total + uploads.total,
    },
    sections: {
      generated_m3u: m3u.files,
      uploads: uploads.files,
      cache: [],
    },
    by_user: null,
  };
}

/** Full storage for admin: every user + shared cache/db. */
export function getAdminStorage() {
  const users = listUsers();
  const byUser = [];
  let m3uTotal = 0;
  let uploadsTotal = 0;
  const allM3u = [];
  const allUploads = [];

  for (const u of users) {
    const outDir = userOutputDir(u.username);
    const m3u = dirSize(outDir, {
      filterName: (name) =>
        name.endsWith(".m3u") || name.endsWith(".xml") || name.endsWith(".gz"),
      relBase: OUTPUT_DIR,
    });
    const playlists = listPlaylists(u.id, false).map((p) => ({
      ...p,
      username: u.username,
    }));
    const uploads = uploadsForPlaylists(playlists);
    const userTotal = m3u.total + uploads.total;
    m3uTotal += m3u.total;
    uploadsTotal += uploads.total;
    allM3u.push(...m3u.files.map((f) => ({ ...f, username: u.username })));
    allUploads.push(...uploads.files);
    byUser.push({
      id: u.id,
      username: u.username,
      is_admin: !!u.is_admin,
      generated_m3u: m3u.total,
      uploads: uploads.total,
      total: userTotal,
      m3u_files: m3u.files,
      upload_files: uploads.files,
    });
  }

  const cache = dirSize(CACHE_DIR, { relBase: CACHE_DIR });
  let dbSize = 0;
  try {
    dbSize = fs.statSync(DB_PATH).size;
  } catch {
    /* empty */
  }

  return {
    scope: "admin",
    username: null,
    totals: {
      generated_m3u: m3uTotal,
      uploads: uploadsTotal,
      cache: cache.total,
      database: dbSize,
      all: m3uTotal + uploadsTotal + cache.total + dbSize,
    },
    sections: {
      generated_m3u: allM3u,
      uploads: allUploads,
      cache: cache.files.slice(0, 80),
    },
    by_user: byUser.sort((a, b) => b.total - a.total),
  };
}

export function deleteUserGenerated(username) {
  const dir = userOutputDir(username);
  if (!fs.existsSync(dir)) return false;
  // Safety: only delete under OUTPUT_DIR
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(OUTPUT_DIR))) return false;
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
}

export function deletePlaylistUploads(playlistId) {
  const dir = path.join(UPLOADS_DIR, String(playlistId));
  if (!fs.existsSync(dir)) return false;
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) return false;
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
}

export function deleteUserUploads(userId) {
  const playlists = listPlaylists(userId, false);
  let n = 0;
  for (const pl of playlists) {
    if (deletePlaylistUploads(pl.id)) n += 1;
  }
  return n;
}

export function deletePlaylistGenerated(username, slug) {
  const dir = path.join(OUTPUT_DIR, String(username || "").toLowerCase(), String(slug || ""));
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(OUTPUT_DIR))) return false;
  if (!fs.existsSync(resolved)) return false;
  fs.rmSync(resolved, { recursive: true, force: true });
  return true;
}

/** Bytes used by a user's generated + uploads (for quota UI). */
export function userStorageBytes(user) {
  return getUserStorage(user).totals.all || 0;
}

export function deleteAllGenerated() {
  if (!fs.existsSync(OUTPUT_DIR)) return;
  for (const name of fs.readdirSync(OUTPUT_DIR)) {
    fs.rmSync(path.join(OUTPUT_DIR, name), { recursive: true, force: true });
  }
}

export function clearCache() {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Delete a single generated or upload file.
 * Returns true if deleted. Enforces path stays under OUTPUT_DIR / UPLOADS_DIR.
 */
export function deleteOneStoredFile(user, { kind, rel, filePath } = {}) {
  const isAdmin = !!user?.is_admin;
  const kindNorm = String(kind || "").toLowerCase();

  if (kindNorm === "generated" || kindNorm === "generated_m3u") {
    let target = filePath ? path.resolve(filePath) : null;
    if (!target && rel) {
      target = path.resolve(OUTPUT_DIR, String(rel).replace(/^[/\\]+/, ""));
    }
    if (!target) return false;
    const root = path.resolve(OUTPUT_DIR);
    if (!target.startsWith(root + path.sep) && target !== root) return false;
    if (!isAdmin) {
      const mine = path.resolve(userOutputDir(user.username));
      if (!target.startsWith(mine + path.sep) && target !== mine) return false;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
    fs.unlinkSync(target);
    // Remove empty parent dirs under user slug
    try {
      const parent = path.dirname(target);
      if (!fs.readdirSync(parent).length) fs.rmdirSync(parent);
    } catch {
      /* ignore */
    }
    return true;
  }

  if (kindNorm === "upload" || kindNorm === "uploads") {
    let target = filePath ? path.resolve(filePath) : null;
    if (!target && rel) {
      target = path.resolve(UPLOADS_DIR, String(rel).replace(/^[/\\]+/, ""));
    }
    if (!target) return false;
    const root = path.resolve(UPLOADS_DIR);
    if (!target.startsWith(root + path.sep) && target !== root) return false;
    // playlist id is first path segment under uploads
    const relToRoot = path.relative(root, target).split(path.sep);
    const plId = Number(relToRoot[0]);
    if (!Number.isFinite(plId)) return false;
    if (!isAdmin) {
      const playlists = listPlaylists(user.id, false);
      if (!playlists.some((p) => p.id === plId)) return false;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
    fs.unlinkSync(target);
    return true;
  }

  return false;
}
