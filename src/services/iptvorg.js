import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, HTTP_TIMEOUT } from "../config.js";

const COUNTRIES_API = "https://iptv-org.github.io/api/countries.json";
export const IPTV_COUNTRY_M3U =
  "https://iptv-org.github.io/iptv/countries/{code}.m3u";

const PRIORITY_CODES = [
  "US", "CA", "UK", "MX", "AU", "IN", "PK", "AE", "SA", "DE",
  "FR", "IT", "ES", "BR", "AR", "JP", "KR", "CN", "TR", "NL",
];

const cacheFile = path.join(CACHE_DIR, "iptv_org_countries.json");
let memory = null;

export function m3uUrlForCountry(code) {
  return IPTV_COUNTRY_M3U.replace("{code}", code.trim().toLowerCase());
}

export function isCountryM3uUrl(url) {
  return /iptv-org\.github\.io\/iptv\/countries\//i.test(url || "");
}

export async function listCountries() {
  const now = Date.now();
  if (memory && now - memory[0] < 3_600_000) return memory[1];
  try {
    if (fs.existsSync(cacheFile)) {
      const age = now - fs.statSync(cacheFile).mtimeMs;
      if (age < 24 * 3_600_000) {
        const data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        memory = [now, data];
        return data;
      }
    }
  } catch {
    /* fetch fresh */
  }
  const res = await fetch(COUNTRIES_API, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
  });
  if (!res.ok) throw new Error(`countries API ${res.status}`);
  const raw = await res.json();
  const list = raw
    .map((c) => ({ code: (c.code || "").toUpperCase(), name: c.name || c.code }))
    .filter((c) => c.code);
  list.sort((a, b) => {
    const ai = PRIORITY_CODES.indexOf(a.code);
    const bi = PRIORITY_CODES.indexOf(b.code);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.name.localeCompare(b.name);
  });
  fs.writeFileSync(cacheFile, JSON.stringify(list));
  memory = [now, list];
  return list;
}

export function composeSourceM3uUrl(countries, customUrlsText) {
  const codes = String(countries || "")
    .split(/\s+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const countryUrls = codes.map((c) => m3uUrlForCountry(c));
  const countrySet = new Set(countryUrls.map((u) => u.toLowerCase()));
  // Keep explicit custom URLs (including iptv-org links the user pasted).
  // Only skip ones already covered by selected countries.
  const custom = String(customUrlsText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("local://") &&
        !countrySet.has(l.toLowerCase())
    );
  const seen = new Set();
  const out = [];
  for (const u of [...countryUrls, ...custom]) {
    const key = u.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  }
  return out.join("\n");
}

/** Explicit M3U URLs from the URL source field (keeps country playlists if pasted). */
export function customM3uUrls(sourceM3uUrl, { skipCountryUrls = false } = {}) {
  return String(sourceM3uUrl || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || l.startsWith("local://")) return false;
      if (skipCountryUrls && isCountryM3uUrl(l)) return false;
      return true;
    });
}

export function resolveM3uUrls(pl) {
  const composed = composeSourceM3uUrl(pl.countries, pl.source_m3u_url);
  return composed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
