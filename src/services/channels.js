import { getDb, utcnow } from "../db/schema.js";
import { classifyCategory, categoryFromSourceGroup } from "./categories.js";
import {
  matchChannels,
  parseCsvNames,
  parseQualityFilter,
  channelMatchesQuality,
  qualityLabel,
  normalizeNameForDedupe,
} from "./m3u.js";

export function listChannels(playlistId, enabledOnly = false) {
  const sql = enabledOnly
    ? `SELECT * FROM playlist_channels WHERE playlist_id = ? AND enabled = 1 ORDER BY position, id`
    : `SELECT * FROM playlist_channels WHERE playlist_id = ? ORDER BY position, id`;
  return getDb().prepare(sql).all(playlistId);
}

export function updateChannel(channelId, fields) {
  const allowed = [
    "custom_name",
    "category",
    "enabled",
    "source_url",
    "source_name",
    "source_logo",
    "source_tvg_id",
    "source_group",
    "position",
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = ?`);
      vals.push(k === "enabled" ? (fields[k] ? 1 : 0) : fields[k]);
    }
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  vals.push(utcnow(), channelId);
  getDb()
    .prepare(`UPDATE playlist_channels SET ${sets.join(", ")} WHERE id = ?`)
    .run(...vals);
}

export function getChannel(channelId) {
  return (
    getDb().prepare("SELECT * FROM playlist_channels WHERE id = ?").get(channelId) ||
    null
  );
}

export function deleteChannel(channelId) {
  getDb().prepare("DELETE FROM playlist_channels WHERE id = ?").run(channelId);
}

export function deleteChannelsByCategory(playlistId, categoryName) {
  const cat = (categoryName || "Other").trim() || "Other";
  const rows = getDb()
    .prepare(
      "SELECT * FROM playlist_channels WHERE playlist_id = ? AND category = ?"
    )
    .all(playlistId, cat);
  getDb()
    .prepare(
      "DELETE FROM playlist_channels WHERE playlist_id = ? AND category = ?"
    )
    .run(playlistId, cat);
  return rows;
}

export function renameCategory(playlistId, fromName, toName) {
  const from = (fromName || "Other").trim() || "Other";
  const to = (toName || "Other").trim() || "Other";
  if (from === to) return 0;
  const info = getDb()
    .prepare(
      `UPDATE playlist_channels SET category = ?, updated_at = ?
       WHERE playlist_id = ? AND category = ?`
    )
    .run(to, utcnow(), playlistId, from);
  return info.changes || 0;
}

/** Create a manual channel (not from source). */
export function createChannel(playlistId, data = {}) {
  const db = getDb();
  const existing = listChannels(playlistId);
  const name = String(data.name || data.custom_name || "New channel").trim() || "New channel";
  const url = String(data.source_url || data.url || "").trim();
  const logo = String(data.source_logo || data.logo || "").trim();
  const tvg = String(data.source_tvg_id || data.tvg_id || "").trim();
  const category =
    String(data.category || "").trim() ||
    classifyCategory(name, "") ||
    "Other";
  if (url) {
    const dup = existing.some(
      (c) =>
        (c.source_url || "") === url &&
        (c.source_tvg_id || "") === tvg
    );
    if (dup) return null;
  }
  const pos = Math.max(0, ...existing.map((c) => c.position), 0) + 1;
  const now = utcnow();
  const info = db
    .prepare(
      `INSERT INTO playlist_channels (
        playlist_id, position, requested_name, source_tvg_id, source_name,
        source_url, source_logo, source_group, custom_name, category, enabled,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      playlistId,
      pos,
      name,
      tvg,
      name,
      url,
      logo,
      "",
      name,
      category,
      now,
      now
    );
  removeStashEntry(playlistId, tvg, url);
  return getChannel(info.lastInsertRowid);
}

export function listStash(playlistId) {
  return getDb()
    .prepare(
      `SELECT * FROM playlist_channel_stash
       WHERE playlist_id = ? ORDER BY id DESC`
    )
    .all(playlistId);
}

export function stashChannel(playlistId, ch = {}) {
  const name = String(ch.name || ch.custom_name || ch.source_name || "").trim();
  const url = String(ch.url || "").trim();
  const tvg = String(ch.tvg_id || "").trim();
  if (!name && !url && !tvg) return null;
  const db = getDb();
  db.prepare(
    `DELETE FROM playlist_channel_stash
     WHERE playlist_id = ? AND tvg_id = ? AND url = ?`
  ).run(playlistId, tvg, url);
  // Also drop any prior stash for same saved channel id
  const channelId = ch.channel_id != null ? Number(ch.channel_id) : null;
  if (channelId) {
    db.prepare(
      `DELETE FROM playlist_channel_stash
       WHERE playlist_id = ? AND channel_id = ?`
    ).run(playlistId, channelId);
  }
  const info = db
    .prepare(
      `INSERT INTO playlist_channel_stash (
        playlist_id, name, tvg_id, url, logo, group_title, category, quality,
        channel_id, custom_name, source_name, requested_name, position, enabled,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      playlistId,
      name,
      tvg,
      url,
      String(ch.logo || "").trim(),
      String(ch.group || ch.group_title || "").trim(),
      String(ch.category || "Other").trim() || "Other",
      String(ch.quality || "other").trim() || "other",
      channelId,
      String(ch.custom_name || name).trim(),
      String(ch.source_name || name).trim(),
      String(ch.requested_name || name).trim(),
      ch.position != null ? Number(ch.position) : null,
      ch.enabled == null ? 1 : ch.enabled ? 1 : 0,
      utcnow()
    );
  return info.lastInsertRowid;
}

export function stashFromPlaylistChannel(row) {
  if (!row) return null;
  const name =
    row.custom_name || row.source_name || row.requested_name || "";
  return stashChannel(row.playlist_id, {
    channel_id: row.id,
    name,
    custom_name: row.custom_name || "",
    source_name: row.source_name || "",
    requested_name: row.requested_name || "",
    tvg_id: row.source_tvg_id || "",
    url: row.source_url || "",
    logo: row.source_logo || "",
    group: row.source_group || "",
    category: row.category || "Other",
    quality: qualityLabel(name, row.source_tvg_id || ""),
    position: row.position,
    enabled: row.enabled,
  });
}

export function removeStashEntry(playlistId, tvgId, url) {
  getDb()
    .prepare(
      `DELETE FROM playlist_channel_stash
       WHERE playlist_id = ? AND tvg_id = ? AND url = ?`
    )
    .run(playlistId, tvgId || "", url || "");
}

export function findStashEntry(playlistId, tvgId, url) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM playlist_channel_stash
         WHERE playlist_id = ? AND tvg_id = ? AND url = ?
         LIMIT 1`
      )
      .get(playlistId, tvgId || "", url || "") || null
  );
}

function ensureAutoIncrementAtLeast(db, table, id) {
  if (!id) return;
  try {
    const row = db
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
      .get(table);
    if (!row) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(
        table,
        id
      );
    } else if (Number(row.seq) < id) {
      db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(
        id,
        table
      );
    }
  } catch {
    /* sequence table may be missing until first AUTOINCREMENT insert */
  }
}

/** Re-add a stashed channel, preferring the previously saved channel id. */
export function restoreStashedChannel(playlistId, tvgId, url) {
  const s = findStashEntry(playlistId, tvgId, url);
  if (!s) return null;
  const existing = listChannels(playlistId);
  if (
    existing.some(
      (c) =>
        (c.source_tvg_id || "") === (s.tvg_id || "") &&
        (c.source_url || "") === (s.url || "")
    )
  ) {
    removeStashEntry(playlistId, s.tvg_id || "", s.url || "");
    return null;
  }

  const name =
    (s.custom_name || "").trim() ||
    (s.source_name || "").trim() ||
    (s.name || "").trim() ||
    "Channel";
  const category = (s.category || "Other").trim() || "Other";
  const pos =
    s.position != null &&
    !existing.some((c) => c.position === Number(s.position))
      ? Number(s.position)
      : Math.max(0, ...existing.map((c) => c.position), 0) + 1;
  const now = utcnow();
  const db = getDb();
  const wantId = s.channel_id != null ? Number(s.channel_id) : 0;
  const idFree = wantId > 0 && !getChannel(wantId);

  let newId;
  if (idFree) {
    db.prepare(
      `INSERT INTO playlist_channels (
        id, playlist_id, position, requested_name, source_tvg_id, source_name,
        source_url, source_logo, source_group, custom_name, category, enabled,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      wantId,
      playlistId,
      pos,
      s.requested_name || name,
      s.tvg_id || "",
      s.source_name || name,
      s.url || "",
      s.logo || "",
      s.group_title || "",
      s.custom_name || name,
      category,
      s.enabled == null ? 1 : s.enabled ? 1 : 0,
      now,
      now
    );
    ensureAutoIncrementAtLeast(db, "playlist_channels", wantId);
    newId = wantId;
  } else {
    const info = db
      .prepare(
        `INSERT INTO playlist_channels (
          playlist_id, position, requested_name, source_tvg_id, source_name,
          source_url, source_logo, source_group, custom_name, category, enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        playlistId,
        pos,
        s.requested_name || name,
        s.tvg_id || "",
        s.source_name || name,
        s.url || "",
        s.logo || "",
        s.group_title || "",
        s.custom_name || name,
        category,
        s.enabled == null ? 1 : s.enabled ? 1 : 0,
        now,
        now
      );
    newId = info.lastInsertRowid;
  }
  removeStashEntry(playlistId, s.tvg_id || "", s.url || "");
  return getChannel(newId);
}

export function clearStash(playlistId) {
  getDb()
    .prepare("DELETE FROM playlist_channel_stash WHERE playlist_id = ?")
    .run(playlistId);
}

export function clearChannels(playlistId) {
  getDb().prepare("DELETE FROM playlist_channels WHERE playlist_id = ?").run(playlistId);
}

export function reorderChannels(playlistId, orderedIds) {
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT id FROM playlist_channels WHERE playlist_id = ? ORDER BY position, id"
    )
    .all(playlistId)
    .map((r) => r.id);
  const seen = new Set(orderedIds);
  const final = orderedIds.filter((i) => existing.includes(i));
  final.push(...existing.filter((i) => !seen.has(i)));
  const now = utcnow();
  db.exec("BEGIN");
  try {
    final.forEach((cid, i) => {
      db.prepare(
        "UPDATE playlist_channels SET position = ?, updated_at = ? WHERE id = ?"
      ).run(-(i + 1), now, cid);
    });
    final.forEach((cid, i) => {
      db.prepare("UPDATE playlist_channels SET position = ? WHERE id = ?").run(
        i + 1,
        cid
      );
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function reorderSubset(playlistId, orderedIds) {
  if (!orderedIds.length) return;
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, position FROM playlist_channels WHERE playlist_id = ? ORDER BY position, id"
    )
    .all(playlistId);
  const idSet = new Set(orderedIds);
  const slots = rows.filter((r) => idSet.has(r.id)).map((r) => r.position).sort((a, b) => a - b);
  const valid = orderedIds.filter((i) => rows.some((r) => r.id === i));
  if (valid.length !== slots.length) return;
  const now = utcnow();
  db.exec("BEGIN");
  try {
    valid.forEach((cid, i) => {
      db.prepare(
        "UPDATE playlist_channels SET position = ?, updated_at = ? WHERE id = ?"
      ).run(-(i + 1), now, cid);
    });
    valid.forEach((cid, i) => {
      db.prepare("UPDATE playlist_channels SET position = ? WHERE id = ?").run(
        slots[i],
        cid
      );
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function reorderCategories(playlistId, orderedNames) {
  const rows = listChannels(playlistId);
  if (!rows.length) return;
  const byCat = {};
  for (const r of rows) {
    const key = (r.category || "Other").trim() || "Other";
    (byCat[key] ||= []).push(r);
  }
  const finalIds = [];
  const seen = new Set();
  for (const name of orderedNames) {
    const key = (name || "Other").trim() || "Other";
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ch of byCat[key] || []) finalIds.push(ch.id);
  }
  for (const [key, chs] of Object.entries(byCat)) {
    if (seen.has(key)) continue;
    for (const ch of chs) finalIds.push(ch.id);
  }
  if (finalIds.length) reorderChannels(playlistId, finalIds);
}

export function setCategoriesEnabled(playlistId, enabledNames, allNames) {
  const nameSet = new Set(
    allNames.map((n) => (n || "Other").trim() || "Other")
  );
  const onSet = new Set(
    [...enabledNames].map((n) => (n || "Other").trim() || "Other")
  );
  let updated = 0;
  for (const r of listChannels(playlistId)) {
    const key = (r.category || "Other").trim() || "Other";
    if (!nameSet.has(key)) continue;
    const want = onSet.has(key) ? 1 : 0;
    const cur = r.enabled ? 1 : 0;
    if (cur !== want) {
      updateChannel(r.id, { enabled: Boolean(want) });
      updated += 1;
    }
  }
  return updated;
}

export function addFromSourceChannel(playlistId, ch) {
  const db = getDb();
  const existing = listChannels(playlistId);
  if (
    existing.some(
      (c) =>
        (c.source_tvg_id || "") === (ch.tvg_id || "") &&
        (c.source_url || "") === (ch.url || "")
    )
  ) {
    return null;
  }
  const pos = Math.max(0, ...existing.map((c) => c.position), 0) + 1;
  const group = ch.group_title || ch.group || "";
  const category =
    String(ch.category || "").trim() ||
    (group ? categoryFromSourceGroup(group) : classifyCategory(ch.name, "")) ||
    "Other";
  const now = utcnow();
  const info = db.prepare(
    `INSERT INTO playlist_channels (
      playlist_id, position, requested_name, source_tvg_id, source_name,
      source_url, source_logo, source_group, custom_name, category, enabled,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    playlistId,
    pos,
    ch.name,
    ch.tvg_id || "",
    ch.name,
    ch.url,
    ch.tvg_logo || ch.logo || "",
    group,
    ch.custom_name != null ? String(ch.custom_name) : "",
    category,
    now,
    now
  );
  removeStashEntry(playlistId, ch.tvg_id || "", ch.url || "");
  return getChannel(info.lastInsertRowid);
}

export function importAllFromSource(playlistId, sourceChannels, qualityFilter = "") {
  const allowed = parseQualityFilter(qualityFilter);
  let added = 0;
  for (const ch of sourceChannels) {
    if (!channelMatchesQuality(ch, allowed)) continue;
    if (addFromSourceChannel(playlistId, ch)) added += 1;
  }
  return added;
}

export function seedFromMatches(
  playlistId,
  channelNamesText,
  sourceChannels,
  {
    matchMode = "smart",
    preferQuality = "best",
    includeAllMatches = false,
    replace = false,
  } = {}
) {
  if (replace) clearChannels(playlistId);
  const names = parseCsvNames(channelNamesText);
  const { missing, results } = matchChannels(names, sourceChannels, {
    matchMode,
    preferQuality,
    includeAllMatches,
  });
  let added = 0;
  for (const detail of results) {
    if (!detail.channel) continue;
    if (addFromSourceChannel(playlistId, detail.channel)) added += 1;
  }
  return { added, missing };
}

export function resolveChannelsForOutput(playlistId, sourceChannels, onProgress = null) {
  const byTvg = new Map();
  const byUrl = new Map();
  for (const c of sourceChannels) {
    if (c.tvg_id) byTvg.set(c.tvg_id, c);
    byUrl.set(c.url, c);
  }
  const selected = listChannels(playlistId, true);
  const output = [];
  const resolved = [];
  const unresolved = [];
  const total = selected.length;

  for (let idx = 0; idx < selected.length; idx++) {
    let row = selected[idx];
    const i = idx + 1;
    const label =
      (row.custom_name || "").trim() ||
      (row.source_name || "").trim() ||
      (row.requested_name || "").trim() ||
      `#${row.id}`;
    let src = null;
    let matchedBy = "";
    const lockedId = (row.source_tvg_id || "").trim();

    if (lockedId && byTvg.has(lockedId)) {
      src = byTvg.get(lockedId);
      matchedBy = "tvg";
    } else if (row.source_url && byUrl.has(row.source_url)) {
      src = byUrl.get(row.source_url);
      matchedBy = "url";
    } else {
      const probe = (
        row.custom_name ||
        row.source_name ||
        row.requested_name ||
        ""
      ).trim();
      if (probe) {
        const { matched } = matchChannels([probe], sourceChannels, {
          matchMode: "smart",
          preferQuality: "best",
        });
        if (matched.length) {
          src = matched[0];
          matchedBy = "name";
        }
      }
    }

    if (!src) {
      // Custom / manual channels keep their own stream URL even if not in source M3U
      const ownUrl = (row.source_url || "").trim();
      if (ownUrl) {
        const custom = (row.custom_name || "").trim();
        const lockedName = (row.source_name || "").trim();
        const displayName =
          custom || lockedName || (row.requested_name || "").trim() || label;
        const category =
          (row.category || "").trim() ||
          classifyCategory(displayName, row.source_group || "") ||
          "Other";
        const stableTvg = lockedId || `ch${row.id}`;
        const logo = (row.source_logo || "").trim();
        output.push({
          name: displayName,
          url: ownUrl,
          tvg_id: stableTvg,
          tvg_logo: logo,
          group_title: category,
          attrs: {
            "tvg-id": stableTvg,
            "tvg-name": displayName,
            "tvg-logo": logo,
            "group-title": category,
            "tvg-chno": String(row.position),
            "channel-id": String(row.id),
          },
          extra_lines: [],
        });
        resolved.push(row);
        if (onProgress) onProgress(i, total, displayName, "ok");
        continue;
      }
      unresolved.push(row);
      if (onProgress) onProgress(i, total, label, "miss");
      continue;
    }

    if (matchedBy === "tvg") {
      if (
        src.url !== row.source_url ||
        src.name !== row.source_name ||
        src.tvg_logo !== row.source_logo
      ) {
        updateChannel(row.id, {
          source_url: src.url,
          source_name: src.name,
          source_logo: src.tvg_logo,
        });
        row = { ...row, source_url: src.url, source_name: src.name, source_logo: src.tvg_logo };
      }
    } else if (matchedBy === "url") {
      const fields = {};
      if (src.tvg_logo !== row.source_logo) fields.source_logo = src.tvg_logo;
      if (!lockedId && src.tvg_id && src.tvg_id !== row.source_tvg_id) {
        fields.source_tvg_id = src.tvg_id;
      }
      if (!Object.keys(fields).length === false || Object.keys(fields).length) {
        if (Object.keys(fields).length) {
          fields.source_url = src.url;
          updateChannel(row.id, fields);
          row = { ...row, ...fields };
        }
      }
    } else if (matchedBy === "name" && src.url !== row.source_url) {
      updateChannel(row.id, { source_url: src.url });
      row = { ...row, source_url: src.url };
    }

    const custom = (row.custom_name || "").trim();
    const lockedName = (row.source_name || "").trim();
    const displayName = custom || lockedName || src.name;
    const category =
      row.category || classifyCategory(displayName, src.group_title);
    let stableTvg = lockedId || src.tvg_id || `ch${row.id}`;
    if (!lockedId && src.tvg_id) {
      updateChannel(row.id, { source_tvg_id: src.tvg_id });
      stableTvg = src.tvg_id;
    }

    const out = {
      name: displayName,
      url: src.url,
      tvg_id: stableTvg,
      tvg_logo: src.tvg_logo || row.source_logo,
      group_title: category,
      attrs: {
        ...(src.attrs || {}),
        "tvg-id": stableTvg,
        "tvg-name": displayName,
        "tvg-logo": src.tvg_logo || row.source_logo,
        "group-title": category,
        "tvg-chno": String(row.position),
        "channel-id": String(row.id),
      },
      extra_lines: src.extra_lines || [],
    };
    output.push(out);
    resolved.push(row);
    if (onProgress) onProgress(i, total, displayName, "ok");
  }

  return { output, resolved, unresolved };
}

export function applyQualityAndDedupe(
  playlistId,
  { qualityFilter = "", preferQuality = "best", dedupeByName = true } = {}
) {
  const rows = listChannels(playlistId);
  const allowed = parseQualityFilter(qualityFilter);
  const keep = new Set();

  if (!dedupeByName) {
    for (const r of rows) {
      const name = r.custom_name || r.source_name || r.requested_name || "";
      const ql = qualityLabel(name, r.source_tvg_id || "");
      if (allowed && !allowed.has(ql)) continue;
      keep.add(r.id);
    }
  } else {
    const groups = new Map();
    for (const r of rows) {
      const name = r.custom_name || r.source_name || r.requested_name || "";
      const key = normalizeNameForDedupe(name) || String(r.id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ r, name, ql: qualityLabel(name, r.source_tvg_id || "") });
    }
    const preferBest = String(preferQuality).toLowerCase() !== "lowest";
    const score = { "4k": 5, "1080": 4, "720": 3, sd: 1, other: 2 };
    for (const items of groups.values()) {
      let filtered = items;
      if (allowed) filtered = items.filter((x) => allowed.has(x.ql));
      if (!filtered.length) continue;
      filtered.sort((a, b) => {
        const sa = score[a.ql] || 2;
        const sb = score[b.ql] || 2;
        return preferBest ? sb - sa : sa - sb;
      });
      keep.add(filtered[0].r.id);
    }
  }

  let removed = 0;
  for (const r of rows) {
    if (!keep.has(r.id)) {
      deleteChannel(r.id);
      removed += 1;
    }
  }
  return removed;
}

/** Parse export-style CSV: position,name,category,tvg_id,enabled,url */
export function parseChannelsCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  const hasHeader = /name|category|tvg|url|position/.test(header);
  const start = hasHeader ? 1 : 0;
  const cols = hasHeader
    ? header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    : ["position", "name", "category", "tvg_id", "enabled", "url"];

  const idx = (names) => {
    for (const n of names) {
      const i = cols.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iPos = idx(["position", "pos"]);
  const iName = idx(["name", "custom_name", "channel"]);
  const iCat = idx(["category", "group", "group-title"]);
  const iTvg = idx(["tvg_id", "tvg-id", "id"]);
  const iEn = idx(["enabled", "on"]);
  const iUrl = idx(["url", "stream"]);

  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  const rows = [];
  for (let li = start; li < lines.length; li++) {
    const parts = splitCsvLine(lines[li]);
    const get = (i) => (i >= 0 ? (parts[i] || "").trim() : "");
    const name = get(iName);
    const url = get(iUrl);
    const tvg = get(iTvg);
    if (!name && !url && !tvg) continue;
    const enRaw = get(iEn).toLowerCase();
    rows.push({
      position: Number(get(iPos)) || rows.length + 1,
      name,
      category: get(iCat) || "Other",
      tvg_id: tvg,
      enabled: !enRaw || ["1", "true", "yes", "on", "y"].includes(enRaw),
      url,
    });
  }
  return rows;
}

function csvRowMatchesChannel(row, ch) {
  if (row.url && ch.source_url && row.url === ch.source_url) return true;
  if (row.tvg_id && ch.source_tvg_id && row.tvg_id === ch.source_tvg_id) {
    if (row.url && ch.source_url && row.url !== ch.source_url) return false;
    return true;
  }
  return false;
}

/**
 * Import CSV arrangement: replace Your list with CSV rows only.
 * Match by url / tvg_id against existing or source, then set category/name/enabled and order.
 */
export function importChannelsCsv(playlistId, csvText, sourceChannels = []) {
  const parsed = parseChannelsCsv(csvText);
  if (!parsed.length) return { updated: 0, added: 0, removed: 0, missing: [] };

  let removed = 0;
  for (const ch of listChannels(playlistId)) {
    if (parsed.some((row) => csvRowMatchesChannel(row, ch))) continue;
    stashFromPlaylistChannel(ch);
    deleteChannel(ch.id);
    removed += 1;
  }

  const existing = listChannels(playlistId);
  const byUrl = new Map(existing.map((c) => [c.source_url, c]));
  const byTvg = new Map(
    existing.filter((c) => c.source_tvg_id).map((c) => [c.source_tvg_id, c])
  );
  const srcByUrl = new Map(sourceChannels.map((c) => [c.url, c]));
  const srcByTvg = new Map(
    sourceChannels.filter((c) => c.tvg_id).map((c) => [c.tvg_id, c])
  );

  const orderedIds = [];
  const seenIds = new Set();
  const missing = [];
  let added = 0;
  let updated = 0;

  for (const row of parsed) {
    let ch = null;
    if (row.url && byUrl.has(row.url)) ch = byUrl.get(row.url);
    else if (row.tvg_id && byTvg.has(row.tvg_id)) ch = byTvg.get(row.tvg_id);

    if (!ch) {
      let src = null;
      if (row.url && srcByUrl.has(row.url)) src = srcByUrl.get(row.url);
      else if (row.tvg_id && srcByTvg.has(row.tvg_id)) src = srcByTvg.get(row.tvg_id);
      else if (row.name) {
        const { matched } = matchChannels([row.name], sourceChannels, {
          matchMode: "smart",
          preferQuality: "best",
        });
        if (matched.length) src = matched[0];
      }
      if (src) {
        const addedRow = addFromSourceChannel(playlistId, src);
        if (addedRow) {
          added += 1;
          ch = addedRow;
          byUrl.set(ch.source_url, ch);
          if (ch.source_tvg_id) byTvg.set(ch.source_tvg_id, ch);
        }
      } else if (row.url || row.name) {
        ch = createChannel(playlistId, {
          name: row.name || "Channel",
          custom_name: row.name,
          source_url: row.url,
          source_tvg_id: row.tvg_id,
          category: row.category,
        });
        if (ch) {
          added += 1;
          if (ch.source_url) byUrl.set(ch.source_url, ch);
          if (ch.source_tvg_id) byTvg.set(ch.source_tvg_id, ch);
        }
      }
    }

    if (!ch) {
      missing.push(row.name || row.tvg_id || row.url || "?");
      continue;
    }

    updateChannel(ch.id, {
      custom_name: row.name || ch.custom_name || ch.source_name,
      category: (row.category || "Other").trim() || "Other",
      enabled: row.enabled,
    });
    updated += 1;
    if (seenIds.has(ch.id)) continue;
    seenIds.add(ch.id);
    orderedIds.push(ch.id);
  }

  if (orderedIds.length) reorderChannels(playlistId, orderedIds);
  return { updated, added, removed, missing };
}

/** Apply category order + per-category channel ids from the UI. */
export function applyChannelLayout(playlistId, catOrder, channelsByCat) {
  const finalIds = [];
  const seen = new Set();
  for (const cat of catOrder) {
    const key = (cat || "Other").trim() || "Other";
    const ids = channelsByCat[key] || [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      updateChannel(id, { category: key });
      finalIds.push(id);
    }
  }
  for (const [cat, ids] of Object.entries(channelsByCat || {})) {
    const key = (cat || "Other").trim() || "Other";
    if (catOrder.includes(key)) continue;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      updateChannel(id, { category: key });
      finalIds.push(id);
    }
  }
  if (finalIds.length) reorderChannels(playlistId, finalIds);
}

/**
 * Safer layout persist for live UI: only touch categories/channels present in the
 * payload. Closed accordion panels (empty id lists) are left unchanged in the DB.
 */
export function applyChannelLayoutPartial(playlistId, catOrder, channelsByCat) {
  if (Array.isArray(catOrder) && catOrder.length) {
    reorderCategories(playlistId, catOrder);
  }
  for (const [cat, ids] of Object.entries(channelsByCat || {})) {
    const key = (cat || "Other").trim() || "Other";
    const list = (ids || []).map(Number).filter(Boolean);
    if (!list.length) continue;
    for (const id of list) {
      const row = getChannel(id);
      if (!row || row.playlist_id !== playlistId) continue;
      if ((row.category || "Other") !== key) {
        updateChannel(id, { category: key });
      }
    }
    reorderSubset(playlistId, list);
  }
}

export { qualityLabel, normalizeNameForDedupe };
