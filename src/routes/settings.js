import { currentUser } from "./auth.js";
import * as settings from "../services/settings.js";
import * as userSettings from "../services/userSettings.js";
import {
  listPlaylists,
  getPlaylist,
  updatePlaylist,
  canAccessPlaylist,
} from "../services/playlists.js";

function formList(body, key) {
  const v = body?.[key];
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === "") return [];
  return [String(v)];
}

const DAY_PRESETS = new Set([
  "0,1,2,3,4,5,6",
  "1,2,3,4,5",
  "0,6",
  "1,2,3,4,5,6",
  "0,1,2,3,4,5",
]);

function normalizeDays(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^[0-6]$/.test(d));
  const uniq = [...new Set(parts)].sort();
  const joined = uniq.join(",");
  if (DAY_PRESETS.has(joined)) return joined;
  return uniq.length ? joined : "0,1,2,3,4,5,6";
}

function normalizeTime(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "04:00";
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export default async function settingsRoutes(app) {
  app.get("/settings", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const refreshPlaylists = listPlaylists(user.id, false);
    return reply.view("settings.ejs", {
      title: "Settings",
      user,
      s: user.is_admin ? settings.getAllSettings() : null,
      refreshPlaylists,
      timezones: userSettings.listTimeZones(),
      message: String(req.query.msg || "").replace(/\+/g, " "),
    });
  });

  app.post("/settings", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const body = req.body || {};

    if (user.is_admin && "public_base_url" in body) {
      settings.setSetting("public_base_url", body.public_base_url || "");
    }
    if (user.is_admin && "storage_quota_mb" in body) {
      const q = Math.max(0, Number(body.storage_quota_mb) || 0);
      settings.setSetting("storage_quota_mb", String(q));
    }
    if (user.is_admin && "max_m3u_upload_mb" in body) {
      const q = Math.max(1, Number(body.max_m3u_upload_mb) || 20);
      settings.setSetting("max_m3u_upload_mb", String(q));
    }

    const knownTz = new Set(userSettings.listTimeZones());
    const ids = formList(body, "playlist_id");
    for (const idRaw of ids) {
      const id = Number(idRaw);
      if (!Number.isFinite(id)) continue;
      const pl = getPlaylist(id);
      if (!canAccessPlaylist(pl, user)) continue;

      let interval = String(body[`interval_${id}`] || "0");
      if (!["0", "6", "12", "24"].includes(interval)) interval = "0";

      const tz = String(body[`tz_${id}`] || "UTC");
      const safeTz = knownTz.has(tz) ? tz : "UTC";

      updatePlaylist(id, {
        enabled: body[`enabled_${id}`] === "1",
        refresh_timezone: safeTz,
        refresh_time: normalizeTime(body[`time_${id}`]),
        refresh_days: normalizeDays(body[`days_${id}`]),
        refresh_interval_hours: interval,
      });
    }

    return reply.redirect("/settings?msg=Saved");
  });
}
