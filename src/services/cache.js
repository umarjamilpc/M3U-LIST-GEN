import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { CACHE_DIR, HTTP_TIMEOUT } from "../config.js";
import * as settings from "./settings.js";

fs.mkdirSync(path.join(CACHE_DIR, "http"), { recursive: true });

function cachePath(url) {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  return path.join(CACHE_DIR, "http", hash);
}

function cacheFresh(filePath, hours = 12) {
  try {
    const st = fs.statSync(filePath);
    const ageH = (Date.now() - st.mtimeMs) / 3_600_000;
    return ageH < hours;
  } catch {
    return false;
  }
}

/** Download URL straight to the cache folder (streamed — not held in RAM). */
export async function fetchUrlCached(url, { force = false, hours = null } = {}) {
  const cacheHours =
    hours != null ? hours : settings.asInt("http_cache_hours", 12);
  const cache = cachePath(url);
  if (!force && cacheFresh(cache, cacheHours)) return cache;

  const tmp = cache + ".tmp";
  const ctrl = AbortSignal.timeout(HTTP_TIMEOUT);
  let res;
  try {
    res = await fetch(url, { signal: ctrl, redirect: "follow" });
  } catch (e) {
    if (fs.existsSync(cache)) return cache;
    throw e;
  }
  if (!res.ok) {
    if (fs.existsSync(cache)) return cache;
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    if (res.body) {
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    } else {
      // Extremely old runtimes without body stream
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(tmp, buf);
    }
    fs.renameSync(tmp, cache);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (fs.existsSync(cache)) return cache;
    throw e;
  }
  return cache;
}

export function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

/** Ensure a local file is available under cache/http (copy once by content hash). */
export function ensureLocalCached(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Missing file: ${filePath}`);
  const st = fs.statSync(abs);
  const key = `local:${abs}:${st.size}:${st.mtimeMs}`;
  const dest = cachePath(key);
  if (fs.existsSync(dest)) {
    try {
      const dst = fs.statSync(dest);
      if (dst.size === st.size) return dest;
    } catch {
      /* rewrite */
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + ".tmp";
  fs.copyFileSync(abs, tmp);
  fs.renameSync(tmp, dest);
  return dest;
}

export { createReadStream, cachePath };
