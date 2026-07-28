import { HTTP_TIMEOUT } from "../config.js";
import { EPG_LIST_GEN_BASE } from "../config.js";
import * as settings from "./settings.js";
import { normalizeEpgUrls } from "./playlists.js";

/** Build default merged EPG URL for a category from EPG-LIST-GEN */
export function defaultMergedEpgUrl(category = "US") {
  const base = (
    settings.getSetting("epg_list_gen_base") || EPG_LIST_GEN_BASE
  ).replace(/\/$/, "");
  const cat = String(category || "US").trim() || "US";
  return `${base}/${cat}/merge/merged-epg.xml.gz`;
}

export function defaultMatchCsvUrl(category = "US") {
  const base = (
    settings.getSetting("epg_list_gen_base") || EPG_LIST_GEN_BASE
  ).replace(/\/$/, "");
  const cat = String(category || "US").trim() || "US";
  return `${base}/${cat}/reports/merge-matched.csv`;
}

/** Parse merge-matched.csv → Map(tvg_id → epg_id_matched) */
export function parseMatchCsv(text) {
  const map = new Map();
  const lines = String(text || "").split(/\r?\n/);
  if (!lines.length) return map;
  const header = lines[0].toLowerCase();
  const cols = header.split(",").map((c) => c.trim());
  const iTvg = cols.indexOf("tvg_id");
  const iEpg = cols.indexOf("epg_id_matched");
  if (iTvg < 0 || iEpg < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");
    const tvg = (parts[iTvg] || "").trim();
    const epg = (parts[iEpg] || "").trim();
    if (tvg && epg) map.set(tvg, epg);
  }
  return map;
}

export async function fetchMatchCsv(url) {
  if (!url) return new Map();
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT) });
  if (!res.ok) throw new Error(`CSV fetch HTTP ${res.status}`);
  return parseMatchCsv(await res.text());
}

/** Apply tvg_id → epg_id mapping onto channel list (mutates) */
export function applyTvgIdMap(channels, idMap) {
  if (!idMap?.size) return 0;
  let n = 0;
  const used = new Set();
  for (const ch of channels) {
    const gid = idMap.get(ch.tvg_id) || idMap.get(String(ch.tvg_id || "").toLowerCase());
    if (!gid || used.has(gid)) continue;
    ch.tvg_id = gid;
    if (ch.attrs) ch.attrs["tvg-id"] = gid;
    used.add(gid);
    n += 1;
  }
  return n;
}

/** Build comma-separated url-tvg value from remote EPG URLs only (no local files). */
export function resolveEpgHeaderUrl(pl) {
  if (!pl.m3u_include_epg) return "";
  const remote = normalizeEpgUrls(pl.epg_url);
  if (!remote) return "";
  return [...new Set(remote.split(",").map((u) => u.trim()).filter(Boolean))].join(",");
}
