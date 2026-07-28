/** M3U parse, match, quality, dedupe, build */

const QUALITY_RE =
  /\s*[\(\[]?\s*(?:[0-9]{3,4}p|HD|FHD|UHD|4K|SD|HEVC|H\.?265)\s*[\)\]]?\s*$/i;
const PAREN_RE = /\s*\([^)]*\)\s*/g;
const BRACKET_RE = /\s*\[[^\]]*\]\s*/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const ATTR_RE = /([a-zA-Z0-9\-]+)="([^"]*)"/g;
const DEDUP_QUALITY_RE =
  /\b(4k|uhd|fhd|hd|sd|1080p?|720p?|2160p?|480p?|360p?|hevc|h\.?265)\b/gi;

export const QUALITY_CHOICES = [
  ["4k", "4K / UHD"],
  ["1080", "1080p / FHD"],
  ["720", "720p / HD"],
  ["sd", "SD"],
  ["other", "Other / unknown"],
];

export function normalizeName(name) {
  let n = (name || "").trim().toLowerCase();
  n = n.replace(QUALITY_RE, "");
  n = n.replace(PAREN_RE, " ");
  n = n.replace(BRACKET_RE, " ");
  n = n.replace(/&/g, " and ");
  n = n.replace(NON_ALNUM_RE, " ");
  return n.split(/\s+/).filter(Boolean).join(" ");
}

export function normalizeNameForDedupe(name) {
  let n = normalizeName(name);
  n = n.replace(DEDUP_QUALITY_RE, " ");
  return n.split(/\s+/).filter(Boolean).join(" ");
}

export function qualityLabel(name, tvgId = "") {
  const blob = `${name} ${tvgId}`.toLowerCase();
  if (/\b(4k|uhd|2160p?)\b/.test(blob)) return "4k";
  if (/\b(1080p?|fhd|full\s*hd)\b/.test(blob)) return "1080";
  if (/\b(720p?)\b/.test(blob)) return "720";
  if (/\bhd\b/.test(blob) && !/\b(fhd|uhd|sd)\b/.test(blob)) return "720";
  if (/\b(sd|480p?|360p?|240p?)\b/.test(blob)) return "sd";
  return "other";
}

function qualityScore(name) {
  return { "4k": 5, "1080": 4, "720": 3, sd: 1, other: 2 }[
    qualityLabel(name)
  ] || 2;
}

export function parseQualityFilter(raw) {
  const allowed = new Set(QUALITY_CHOICES.map((c) => c[0]));
  const parts = String(raw || "")
    .replace(/;/g, ",")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const picked = new Set(parts.filter((p) => allowed.has(p)));
  return picked.size ? picked : null;
}

export function channelMatchesQuality(ch, allowed) {
  if (!allowed) return true;
  return allowed.has(qualityLabel(ch.name, ch.tvg_id));
}

export function parseCsvNames(text) {
  const names = [];
  const seen = new Set();
  for (let raw of String(text || "").split(/\r?\n/)) {
    let line = raw.trim().replace(/^\ufeff/, "");
    if (!line) continue;
    if (["channel name", "name", "channel", "channels"].includes(line.toLowerCase()))
      continue;
    if (line.includes(",") && line.split(",").length === 2) {
      line = line.split(",")[0].trim();
    }
    const key = normalizeName(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(line);
  }
  return names;
}

export function parseM3u(content) {
  const lines = String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return parseM3uLines(lines);
}

/** Parse M3U from a disk path line-by-line (avoids loading the whole file as one string). */
export async function parseM3uFromFile(filePath) {
  const { createReadStream } = await import("node:fs");
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const channels = [];
  let extinf = null;
  let extra = [];
  for await (const raw of rl) {
    const line = String(raw || "").trim();
    if (!extinf) {
      if (!line.startsWith("#EXTINF:")) continue;
      extinf = line;
      extra = [];
      continue;
    }
    if (line.startsWith("#") && !line.startsWith("#EXTINF:")) {
      extra.push(line);
      continue;
    }
    if (!line || line.startsWith("#")) {
      if (line.startsWith("#EXTINF:")) {
        extinf = line;
        extra = [];
      } else {
        extinf = null;
        extra = [];
      }
      continue;
    }
    channels.push(channelFromExtinf(extinf, line, extra));
    extinf = null;
    extra = [];
  }
  return channels;
}

function parseM3uLines(lines) {
  const channels = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF:")) {
      i += 1;
      continue;
    }
    const extinf = line;
    const extra = [];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("#EXTINF:")
    ) {
      extra.push(lines[i].trim());
      i += 1;
    }
    if (i >= lines.length) break;
    const url = lines[i].trim();
    i += 1;
    if (!url || url.startsWith("#")) continue;
    channels.push(channelFromExtinf(extinf, url, extra));
  }
  return channels;
}

function channelFromExtinf(extinf, url, extra = []) {
  const comma = extinf.indexOf(",");
  const meta = comma !== -1 ? extinf.slice(8, comma) : extinf.slice(8);
  const name = comma !== -1 ? extinf.slice(comma + 1).trim() : "";
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(meta))) {
    attrs[m[1]] = m[2];
  }
  return {
    name,
    url,
    tvg_id: attrs["tvg-id"] || "",
    tvg_logo: attrs["tvg-logo"] || "",
    group_title: attrs["group-title"] || "",
    attrs,
    extinf,
    extra_lines: extra,
    get normalized() {
      return normalizeName(this.name);
    },
  };
}

export function dedupeChannelsByName(
  channels,
  { preferQuality = "best", qualityFilter = null } = {}
) {
  const allowed = parseQualityFilter(qualityFilter);
  const preferBest = String(preferQuality || "best").toLowerCase() !== "lowest";
  const byUrl = [];
  const seenUrl = new Set();
  for (const ch of channels) {
    const u = (ch.url || "").trim();
    if (u && seenUrl.has(u)) continue;
    if (u) seenUrl.add(u);
    if (!channelMatchesQuality(ch, allowed)) continue;
    byUrl.push(ch);
  }
  const best = new Map();
  const order = [];
  for (const ch of byUrl) {
    const key =
      normalizeNameForDedupe(ch.name) || ch.tvg_id || ch.url;
    const score = qualityScore(ch.name);
    if (!best.has(key)) {
      best.set(key, ch);
      order.push(key);
      continue;
    }
    const cur = best.get(key);
    const curScore = qualityScore(cur.name);
    if (preferBest && score > curScore) best.set(key, ch);
    else if (!preferBest && score < curScore) best.set(key, ch);
  }
  return order.map((k) => best.get(k));
}

export function scoreMatch(requested, channel, mode) {
  const req = normalizeName(requested);
  const cand = normalizeName(channel.name);
  if (!req || !cand) return 0;

  if (mode === "exact") return req === cand ? 1 : 0;
  if (mode === "contains") {
    if (req === cand) return 1;
    if (req.length >= 3 && (cand.includes(req) || req.includes(cand))) return 0.85;
    return 0;
  }

  if (req === cand) return 1;
  if (
    (cand.startsWith(req + " ") || req.startsWith(cand + " ")) &&
    Math.min(req.length, cand.length) >= 3
  ) {
    return 0.95;
  }
  if (cand.includes(req)) {
    const extra = cand.length - req.length;
    return Math.max(0.72, 0.92 - extra * 0.02);
  }
  if (req.includes(cand)) {
    if (cand.length >= 5 && cand.length / Math.max(req.length, 1) >= 0.55) return 0.8;
    return 0;
  }

  const reqTokens = req.split(" ");
  const candTokens = cand.split(" ");
  const reqSet = new Set(reqTokens);
  const candSet = new Set(candTokens);
  if (!reqSet.size || !candSet.size) return 0;

  const callsign = reqTokens[0];
  if (
    [3, 4, 5].includes(callsign.length) &&
    (callsign[0] === "w" || callsign[0] === "k") &&
    /^[a-z]+$/.test(callsign)
  ) {
    if (candTokens[0]?.startsWith(callsign)) return 0.9;
    if (candTokens.some((t) => t.startsWith(callsign))) return 0.86;
  }

  const filler = new Set(["tv", "channel", "network", "hd", "us", "the"]);
  const reqCore = new Set([...reqSet].filter((t) => !filler.has(t)));
  const candCore = new Set([...candSet].filter((t) => !filler.has(t)));
  if (!reqCore.size || !candCore.size) return 0;
  const overlap = [...reqCore].filter((t) => candCore.has(t));
  if (!overlap.length) return 0;
  if ([...candCore].every((t) => reqCore.has(t)) && candCore.size >= 2) return 0.78;
  if ([...reqCore].every((t) => candCore.has(t))) return 0.88;
  if (overlap.length >= 2 && overlap.length / reqCore.size >= 0.6) return 0.74;
  return 0;
}

export function matchChannels(
  requestedNames,
  channels,
  {
    matchMode = "smart",
    preferQuality = "best",
    includeAllMatches = false,
    minScore = 0.7,
  } = {}
) {
  const results = [];
  const matched = [];
  const missing = [];
  const usedUrls = new Set();

  for (const name of requestedNames) {
    const scored = [];
    for (const ch of channels) {
      const s = scoreMatch(name, ch, matchMode);
      if (s >= minScore) scored.push([s, ch]);
    }
    if (!scored.length) {
      missing.push(name);
      results.push({ requested: name, channel: null, score: 0 });
      continue;
    }
    scored.sort((a, b) => {
      if (b[0] !== a[0]) return b[0] - a[0];
      const qa = qualityScore(a[1].name);
      const qb = qualityScore(b[1].name);
      return preferQuality === "best" ? qb - qa : qa - qb;
    });
    const chosen = includeAllMatches
      ? scored.filter(([s]) => s >= scored[0][0] - 0.05).map(([, c]) => c)
      : [scored[0][1]];
    for (const ch of chosen) {
      if (usedUrls.has(ch.url)) continue;
      usedUrls.add(ch.url);
      matched.push(ch);
      results.push({ requested: name, channel: ch, score: scored[0][0] });
    }
  }
  return { matched, missing, results };
}

export function buildM3u(channels, epgUrl = "") {
  let header = "#EXTM3U";
  if (epgUrl) {
    header += ` url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"`;
  }
  const parts = [header];
  for (const ch of channels) {
    const values = {
      "tvg-id": ch.tvg_id,
      "tvg-name": ch.name,
      "tvg-logo": ch.tvg_logo,
      "group-title": ch.group_title,
      ...(ch.attrs || {}),
    };
    values["tvg-name"] = ch.name;
    const ordered = [
      "tvg-id",
      "tvg-name",
      "tvg-chno",
      "channel-id",
      "tvg-logo",
      "group-title",
    ];
    const attrs = [];
    const written = new Set();
    for (const key of ordered) {
      const val = values[key] || "";
      if (val) {
        attrs.push(`${key}="${val}"`);
        written.add(key);
      }
    }
    for (const [k, v] of Object.entries(values)) {
      if (!written.has(k) && v) attrs.push(`${k}="${v}"`);
    }
    const attrStr = attrs.length ? " " + attrs.join(" ") : "";
    parts.push(`#EXTINF:-1${attrStr},${ch.name}`);
    if (ch.extra_lines?.length) parts.push(...ch.extra_lines);
    parts.push(ch.url);
  }
  return parts.join("\n") + "\n";
}

export function rewriteM3uEpgUrls(m3uText, epgUrls) {
  if (!epgUrls) return m3uText;
  const lines = m3uText.split(/\r?\n/);
  if (!lines.length) return m3uText;
  let first = lines[0];
  first = first
    .replace(/\s+url-tvg="[^"]*"/gi, "")
    .replace(/\s+x-tvg-url="[^"]*"/gi, "");
  first = `${first} url-tvg="${epgUrls}" x-tvg-url="${epgUrls}"`;
  lines[0] = first;
  return lines.join("\n");
}
