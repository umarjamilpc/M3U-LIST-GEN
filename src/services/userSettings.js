import { getDb, utcnow } from "../db/schema.js";
import { listUsers } from "./auth.js";

const DEFAULTS = {
  refresh_enabled: "0",
  refresh_timezone: "UTC",
  refresh_time: "04:00",
  refresh_days: "0,1,2,3,4,5,6",
  /** 0 = off, else 6 / 12 / 24 */
  refresh_interval_hours: "0",
  refresh_last_interval_at: "",
  refresh_last_daily_stamp: "",
};

export function getUserSetting(userId, key, fallback = "") {
  const row = getDb()
    .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?")
    .get(userId, key);
  if (row) return row.value;
  return DEFAULTS[key] ?? fallback;
}

export function setUserSetting(userId, key, value) {
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(userId, key, String(value ?? ""), utcnow());
}

export function getUserRefreshSettings(userId) {
  const out = { ...DEFAULTS };
  for (const row of getDb()
    .prepare("SELECT key, value FROM user_settings WHERE user_id = ?")
    .all(userId)) {
    if (row.key in out || row.key.startsWith("refresh_")) {
      out[row.key] = row.value;
    }
  }
  return out;
}

export function setUserRefreshSettings(userId, data) {
  for (const [key, value] of Object.entries(data)) {
    setUserSetting(userId, key, value);
  }
}

export function asUserBool(userId, key, def = false) {
  const v = String(getUserSetting(userId, key, def ? "1" : "0")).toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

export function asUserInt(userId, key, def = 0) {
  const n = Number(getUserSetting(userId, key, String(def)));
  return Number.isFinite(n) ? n : def;
}

/** All IANA time zones available on this Node runtime. */
export function listTimeZones() {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    /* fall through */
  }
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Asia/Karachi",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Australia/Sydney",
  ];
}

const WEEKDAY_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock parts in a given IANA timezone. */
export function wallClockInTz(date, timeZone) {
  const tz = timeZone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const hour = get("hour").padStart(2, "0");
    const minute = get("minute").padStart(2, "0");
    const weekday = WEEKDAY_MAP[get("weekday")] ?? date.getUTCDay();
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return {
      clock: `${hour}:${minute}`,
      weekday,
      dateKey: `${y}-${m}-${d}`,
    };
  } catch {
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    return {
      clock: `${hh}:${mm}`,
      weekday: date.getUTCDay(),
      dateKey: date.toISOString().slice(0, 10),
    };
  }
}

export function listUsersWithRefresh() {
  return listUsers();
}
