import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import * as settings from "./settings.js";
import { getUserSetting, setUserSetting } from "./userSettings.js";
import { getUserStorage } from "./storage.js";

/** Global defaults (MB). 0 quota = unlimited. */
export function getDefaultQuotaMb() {
  return Math.max(0, settings.asInt("storage_quota_mb", 500));
}

export function getMaxM3uUploadMb() {
  return Math.max(1, settings.asInt("max_m3u_upload_mb", 20));
}

export function getMaxEpgUploadMb() {
  return Math.max(1, settings.asInt("max_epg_upload_mb", 50));
}

export function mbToBytes(mb) {
  return Math.round(Number(mb) || 0) * 1024 * 1024;
}

/** Per-user override; empty/missing → use global default. */
export function getUserQuotaMb(userId) {
  const raw = getUserSetting(userId, "storage_quota_mb", "");
  if (raw === "" || raw == null) return getDefaultQuotaMb();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : getDefaultQuotaMb();
}

export function setUserQuotaMb(userId, mb) {
  if (mb === "" || mb == null) {
    setUserSetting(userId, "storage_quota_mb", "");
    return;
  }
  const n = Math.max(0, Number(mb) || 0);
  setUserSetting(userId, "storage_quota_mb", String(n));
}

export function userUsageBytes(user) {
  return getUserStorage(user).totals.all || 0;
}

export function maxUploadBytes(kind) {
  const mb = kind === "epg" ? getMaxEpgUploadMb() : getMaxM3uUploadMb();
  return mbToBytes(mb);
}

/**
 * Throws Error with message if upload would exceed file-size or storage quota.
 * sizeBytes may be 0 if unknown (checked after write).
 */
export function assertUploadAllowed(user, { kind, sizeBytes = 0 } = {}) {
  const maxFile = maxUploadBytes(kind);
  if (sizeBytes > 0 && sizeBytes > maxFile) {
    const label = kind === "epg" ? "EPG" : "M3U";
    throw new Error(
      `${label} upload exceeds limit (${formatMb(maxFile)}). File is ${formatMb(sizeBytes)}.`
    );
  }
  const quotaMb = getUserQuotaMb(user.id);
  if (quotaMb > 0) {
    const quota = mbToBytes(quotaMb);
    const used = userUsageBytes(user);
    if (sizeBytes > 0 && used + sizeBytes > quota) {
      throw new Error(
        `Storage quota exceeded (${formatMb(used)} used of ${formatMb(quota)}). Delete files in Storage or ask an admin to raise your quota.`
      );
    }
    if (sizeBytes <= 0 && used >= quota) {
      throw new Error(
        `Storage quota full (${formatMb(used)} of ${formatMb(quota)}). Delete files in Storage first.`
      );
    }
  }
}

export function assertFileWithinLimits(user, destPath, kind) {
  let size = 0;
  try {
    size = fs.statSync(destPath).size;
  } catch {
    return;
  }
  try {
    assertUploadAllowed(user, { kind, sizeBytes: size });
  } catch (e) {
    try {
      fs.unlinkSync(destPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function formatMb(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Save multipart file field to disk.
 * With @fastify/multipart attachFieldsToBody, content must be read via toBuffer()
 * — the .file stream is already consumed and piping it writes 0 bytes.
 * Returns bytes written, or 0 if empty/skipped.
 */
export async function streamUploadToDisk(fileField, destPath) {
  if (!fileField) return 0;

  // Buffer from attachFieldsToBody: 'keyValues'
  if (Buffer.isBuffer(fileField)) {
    if (!fileField.length) return 0;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, fileField);
    return fileField.length;
  }

  const looksLikeFile =
    fileField.type === "file" ||
    typeof fileField.toBuffer === "function" ||
    (fileField.file && typeof fileField.file.pipe === "function");
  if (!looksLikeFile) return 0;

  // Skip empty file inputs (no file chosen)
  const fname = String(fileField.filename || "").trim();
  if (fileField.type === "file" && !fname && typeof fileField.toBuffer === "function") {
    // still try toBuffer — some clients omit filename
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = destPath + ".tmp";

  try {
    let buf = null;
    // Prefer toBuffer — required when attachFieldsToBody already drained the stream
    if (typeof fileField.toBuffer === "function") {
      buf = await fileField.toBuffer();
    } else if (fileField._buf && Buffer.isBuffer(fileField._buf)) {
      buf = fileField._buf;
    }

    if (buf && buf.length) {
      fs.writeFileSync(tmp, buf);
    } else if (fileField.file && typeof fileField.file.pipe === "function") {
      await pipeline(fileField.file, createWriteStream(tmp));
    } else {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      return 0;
    }

    const st = fs.statSync(tmp);
    if (!st.size) {
      fs.unlinkSync(tmp);
      return 0;
    }
    fs.renameSync(tmp, destPath);
    return st.size;
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}
