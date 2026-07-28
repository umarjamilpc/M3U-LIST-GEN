import { getDb, utcnow } from "../db/schema.js";

const DEFAULTS = {
  public_base_url: "",
  refresh_enabled: "1",
  refresh_timezone: "UTC",
  refresh_time: "04:00",
  refresh_days: "0,1,2,3,4,5,6",
  http_cache_hours: "12",
  http_timeout: "120",
  default_countries: "US",
  epg_list_gen_base:
    "https://raw.githubusercontent.com/umarjamilpc/EPG-LIST-GEN/main/epgs",
  /** Default per-user storage quota in MB (0 = unlimited) */
  storage_quota_mb: "500",
  /** Max single M3U upload size in MB */
  max_m3u_upload_mb: "20",
  /** Max single EPG upload size in MB */
  max_epg_upload_mb: "50",
};

export function getSetting(key, fallback = "") {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (row) return row.value;
  return DEFAULTS[key] ?? fallback;
}

export function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, String(value ?? ""), utcnow());
}

export function getAllSettings() {
  const out = { ...DEFAULTS };
  for (const row of getDb().prepare("SELECT key, value FROM settings").all()) {
    out[row.key] = row.value;
  }
  return out;
}

export function asBool(key, def = false) {
  const v = String(getSetting(key, def ? "1" : "0")).toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

export function asInt(key, def = 0) {
  const n = Number(getSetting(key, String(def)));
  return Number.isFinite(n) ? n : def;
}
