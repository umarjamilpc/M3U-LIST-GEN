import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

/** Load KEY=VALUE pairs from a .env file into process.env (does not override existing). */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(ROOT, ".env"));

export const DATA_DIR = path.resolve(
  process.env.DATA_DIR && String(process.env.DATA_DIR).trim()
    ? process.env.DATA_DIR
    : path.join(ROOT, "data")
);
export const DB_PATH = path.join(DATA_DIR, "iptv.db");
export const OUTPUT_DIR = path.join(DATA_DIR, "output");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

export const SECRET_KEY = process.env.SECRET_KEY || "change-me-in-production";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(
  /\/$/,
  ""
);
export const PORT = Number(process.env.PORT || 3000);
export const HTTP_TIMEOUT = Number(process.env.HTTP_TIMEOUT || 120_000);
export const SESSION_MAX_AGE = Number(
  process.env.SESSION_MAX_AGE || 60 * 60 * 24 * 14
);

/** Default EPG-LIST-GEN category template */
export const EPG_LIST_GEN_BASE =
  process.env.EPG_LIST_GEN_BASE ||
  "https://raw.githubusercontent.com/umarjamilpc/EPG-LIST-GEN/main/epgs";

for (const d of [DATA_DIR, OUTPUT_DIR, CACHE_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}
