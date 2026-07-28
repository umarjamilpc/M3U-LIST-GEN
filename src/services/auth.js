import crypto from "node:crypto";
import { getDb, utcnow } from "../db/schema.js";
import {
  listPlaylists,
  deletePlaylist,
  cleanupOrphanPlaylistData,
} from "./playlists.js";
import { deleteUserGenerated } from "./storage.js";

const ITERATIONS = 260_000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  return `pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

export function verifyPassword(password, passwordHash) {
  try {
    const [algo, iterStr, saltB64, hashB64] = passwordHash.split("$");
    if (algo !== "pbkdf2") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const dk = crypto.pbkdf2Sync(
      password,
      salt,
      Number(iterStr),
      expected.length,
      "sha256"
    );
    return crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

export function createUser(username, password, isAdmin = false) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, is_admin, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(username.trim().toLowerCase(), hashPassword(password), isAdmin ? 1 : 0, utcnow());
  return getUserById(info.lastInsertRowid);
}

export function getUserById(id) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function getUserByUsername(username) {
  return (
    getDb()
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(username.trim()) || null
  );
}

export function authenticate(username, password) {
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return user;
}

export function listUsers() {
  return getDb()
    .prepare(
      "SELECT id, username, is_admin, created_at FROM users ORDER BY username"
    )
    .all();
}

export function ensureAdmin(username, password) {
  if (getUserByUsername(username)) return;
  createUser(username, password, true);
}

/** Delete a user and all playlists, channels, settings, uploads, and output files. */
export function deleteUser(userId) {
  const id = Number(userId);
  const user = getUserById(id);
  if (!user) return false;

  const playlists = listPlaylists(id, false);
  for (const pl of playlists) {
    deletePlaylist(pl.id, { vacuum: false });
  }

  const db = getDb();
  db.prepare("DELETE FROM user_settings WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);

  try {
    deleteUserGenerated(user.username);
  } catch {
    /* ignore */
  }

  cleanupOrphanPlaylistData({ vacuum: true });
  return true;
}
