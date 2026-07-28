import { currentUser } from "./auth.js";
import {
  getPlaylist,
  canAccessPlaylist,
  updatePlaylist,
  loadSourceChannels,
} from "../services/playlists.js";
import * as chstore from "../services/channels.js";
import { CATEGORIES, classifyCategory } from "../services/categories.js";
import {
  QUALITY_CHOICES,
  parseQualityFilter,
  qualityLabel,
  normalizeName,
  normalizeNameForDedupe,
} from "../services/m3u.js";

function formList(body, key) {
  const v = body?.[key];
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === "") return [];
  return [String(v)];
}

function channelsNext(playlistId, msg, wizard, cat = "", srcCat = "") {
  const q = new URLSearchParams();
  if (wizard) q.set("wizard", "1");
  if (cat) q.set("cat", cat);
  if (srcCat) q.set("src_cat", srcCat);
  if (msg) q.set("msg", msg);
  const qs = q.toString();
  return `/playlists/${playlistId}/channels${qs ? `?${qs}` : ""}`;
}

function publicChannel(c) {
  const name = c.custom_name || c.source_name || c.requested_name || "";
  return {
    id: c.id,
    name,
    tvg_id: c.source_tvg_id || "",
    url: c.source_url || "",
    logo: c.source_logo || "",
    group: c.source_group || "",
    category: (c.category || "Other").trim() || "Other",
    quality: qualityLabel(name, c.source_tvg_id || ""),
  };
}

async function restorableFromSource(pl, ch) {
  if (!(ch.source_url || ch.source_tvg_id)) return false;
  try {
    const source = await loadSourceChannels(pl);
    const key = `${ch.source_tvg_id || ""}|${ch.source_url || ""}`;
    return source.some(
      (s) => `${s.tvg_id || ""}|${s.url || ""}` === key
    );
  } catch {
    return Boolean(ch.source_url);
  }
}

/** Remaining source (+ stash) channels grouped by category, optional search. */
function buildRemainingByCat(playlistId, source, selected, q, allowedQ) {
  const selectedKeys = new Set(
    selected.map((c) => `${c.source_tvg_id || ""}|${c.source_url || ""}`)
  );
  const qn = q ? normalizeName(q) : "";
  const remainingByCat = {};
  const remainingKeys = new Set();

  for (const ch of source) {
    const key = `${ch.tvg_id || ""}|${ch.url || ""}`;
    if (selectedKeys.has(key)) continue;
    const ql = qualityLabel(ch.name, ch.tvg_id);
    if (allowedQ && !allowedQ.has(ql)) continue;
    if (
      qn &&
      !normalizeName(ch.name).includes(qn) &&
      !normalizeName(ch.tvg_id).includes(qn)
    ) {
      continue;
    }
    const scat = classifyCategory(ch.name, ch.group_title);
    remainingKeys.add(key);
    (remainingByCat[scat] ||= []).push({
      name: ch.name,
      tvg_id: ch.tvg_id || "",
      url: ch.url || "",
      group: ch.group_title || "",
      category: scat,
      quality: ql,
      logo: ch.tvg_logo || "",
      from_stash: false,
    });
  }

  for (const s of chstore.listStash(playlistId)) {
    const key = `${s.tvg_id || ""}|${s.url || ""}`;
    if (selectedKeys.has(key)) {
      chstore.removeStashEntry(playlistId, s.tvg_id || "", s.url || "");
      continue;
    }
    if (remainingKeys.has(key)) continue;
    if (
      qn &&
      !normalizeName(s.name).includes(qn) &&
      !normalizeName(s.tvg_id).includes(qn)
    ) {
      continue;
    }
    const scat = (s.category || "Other").trim() || "Other";
    remainingKeys.add(key);
    (remainingByCat[scat] ||= []).push({
      name: s.name,
      tvg_id: s.tvg_id || "",
      url: s.url || "",
      group: s.group_title || "",
      category: scat,
      quality: s.quality || qualityLabel(s.name, s.tvg_id),
      logo: s.logo || "",
      from_stash: true,
    });
  }

  const sourceCatCounts = Object.entries(remainingByCat)
    .map(([k, v]) => [k, v.length])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const sourceRemaining = Object.values(remainingByCat).reduce(
    (a, v) => a + v.length,
    0
  );

  return { remainingByCat, sourceCatCounts, sourceRemaining };
}

function pickSrcCat(remainingByCat, sourceCatCounts, preferred) {
  let srcCat = String(preferred || "").trim();
  if (!srcCat && sourceCatCounts.length) srcCat = sourceCatCounts[0][0];
  if (srcCat && !remainingByCat[srcCat] && sourceCatCounts.length) {
    srcCat = sourceCatCounts[0][0];
  }
  return srcCat;
}

function wantsJson(req) {
  const accept = String(req.headers.accept || "");
  return (
    String(req.headers["x-requested-with"] || "").toLowerCase() === "fetch" ||
    accept.includes("application/json")
  );
}

export default async function channelRoutes(app) {
  app.get("/playlists/:id/channels", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");

    // Wizard chrome only when ?wizard=1 (setup). Edit channels uses wizard=0.
    const wizard = ["1", "true", "yes"].includes(
      String(req.query.wizard == null || req.query.wizard === "" ? "0" : req.query.wizard).toLowerCase()
    );
    const q = ""; // live search uses /source-preview; keep full category on page load
    let cat = String(req.query.cat || "").trim();
    let srcCat = String(req.query.src_cat || "").trim();
    const qUi = String(req.query.q || "");

    let selected = chstore.listChannels(playlistId);
    let sourceError = null;
    let source = [];
    try {
      source = await loadSourceChannels(pl);
      if (source?._sourceErrors?.length) {
        sourceError =
          `Some sources failed: ${source._sourceErrors.slice(0, 3).join("; ")}`;
      }
    } catch (e) {
      sourceError = String(e.message || e);
    }

    const qfRaw = pl.quality_filter || "";
    const allowedQ = parseQualityFilter(qfRaw);
    // Do not auto-import source into Your list — new source channels only appear
    // under Add from source. Reset is the only overwrite path.
    let autoMsg = null;

    const catCounter = new Map();
    const catOn = new Map();
    const orderedCats = [];
    for (const c of selected) {
      const key = (c.category || "Other").trim() || "Other";
      if (!catCounter.has(key)) {
        orderedCats.push(key);
        catCounter.set(key, 0);
        catOn.set(key, 0);
      }
      catCounter.set(key, catCounter.get(key) + 1);
      if (c.enabled) catOn.set(key, catOn.get(key) + 1);
    }
    if (cat && !catCounter.has(cat)) cat = "";

    const openChannels = [];
    for (const c of selected) {
      const ccat = (c.category || "Other").trim() || "Other";
      if (!cat || ccat !== cat) continue;
      const name = c.custom_name || c.source_name || c.requested_name || "";
      openChannels.push({
        ...c,
        quality: qualityLabel(name, c.source_tvg_id || ""),
        dedupe_key: normalizeNameForDedupe(name) || String(c.id),
      });
    }

    const categoryGroups = orderedCats.map((name) => ({
      name,
      count: catCounter.get(name),
      enabled:
        catOn.get(name) === catCounter.get(name) && catCounter.get(name) > 0,
      open: name === cat,
      channels: name === cat ? openChannels : [],
    }));

    const { remainingByCat, sourceCatCounts, sourceRemaining } =
      buildRemainingByCat(playlistId, source, selected, q, allowedQ);
    srcCat = pickSrcCat(remainingByCat, sourceCatCounts, srcCat);
    const sourcePreview = remainingByCat[srcCat] || [];

    const catOpts = [...CATEGORIES];
    const seen = new Set(catOpts);
    for (const cg of categoryGroups) {
      if (cg.name && !seen.has(cg.name)) {
        catOpts.push(cg.name);
        seen.add(cg.name);
      }
    }

    return reply.view("channels.ejs", {
      title: `Channels · ${pl.name}`,
      user,
      playlist: pl,
      selected: openChannels,
      selected_total: selected.length,
      category_groups: categoryGroups,
      active_cat: cat,
      source_preview: sourcePreview,
      source_error: sourceError,
      source_loaded: true,
      source_total: source.length,
      source_remaining: sourceRemaining,
      source_cat_counts: sourceCatCounts,
      active_src_cat: srcCat,
      categories: catOpts,
      q: qUi,
      message: req.query.msg || autoMsg,
      wizard,
      quality_choices: QUALITY_CHOICES,
      quality_filter: allowedQ || new Set(),
      prefer_quality: pl.prefer_quality || "best",
      dedupe_by_name:
        pl.dedupe_by_name == null ? true : Boolean(pl.dedupe_by_name),
    });
  });

  app.get("/playlists/:id/channels/source-preview", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }

    const q = String(req.query.q || "");
    let srcCat = String(req.query.src_cat || "").trim();
    let source = [];
    let sourceError = null;
    try {
      source = await loadSourceChannels(pl);
      if (source?._sourceErrors?.length) {
        sourceError = source._sourceErrors.slice(0, 3).join("; ");
      }
    } catch (e) {
      sourceError = String(e.message || e);
      source = [];
    }

    const selected = chstore.listChannels(playlistId);
    const allowedQ = parseQualityFilter(pl.quality_filter || "");
    const { remainingByCat, sourceCatCounts, sourceRemaining } =
      buildRemainingByCat(playlistId, source, selected, q, allowedQ);
    srcCat = pickSrcCat(remainingByCat, sourceCatCounts, srcCat);

    return reply.send({
      ok: true,
      q,
      active_src_cat: srcCat,
      source_total: source.length,
      source_remaining: sourceRemaining,
      source_cat_counts: sourceCatCounts,
      channels: remainingByCat[srcCat] || [],
      source_error: sourceError,
    });
  });

  app.get("/playlists/:id/channels/panel", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send("Unauthorized");
    const pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.code(403).send("Forbidden");
    const activeCat = String(req.query.cat || "").trim();
    const selected = chstore.listChannels(pl.id);
    const channels = [];
    const seenCats = new Set();
    for (const c of selected) {
      const ccat = (c.category || "Other").trim() || "Other";
      seenCats.add(ccat);
      if (ccat !== activeCat) continue;
      const name = c.custom_name || c.source_name || c.requested_name || "";
      channels.push({
        ...c,
        quality: qualityLabel(name, c.source_tvg_id || ""),
        dedupe_key: normalizeNameForDedupe(name) || String(c.id),
      });
    }
    const catOpts = [...CATEGORIES];
    for (const name of [...seenCats].sort()) {
      if (name && !catOpts.includes(name)) catOpts.push(name);
    }
    const ejs = await import("ejs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const viewsDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../views"
    );
    const html = await ejs.default.renderFile(
      path.join(viewsDir, "_channel_cat_panel.ejs"),
      { cat_name: activeCat, channels, categories: catOpts }
    );
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.post("/playlists/:id/channels/save", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    const cat = String(body.cat || "");
    const srcCat = String(body.src_cat || "");

    const catOrderRaw = String(body.cat_order || "").trim();
    const ordered = catOrderRaw
      ? catOrderRaw.split("||").map((c) => c.trim()).filter(Boolean)
      : [];

    const ids = formList(body, "channel_id").map(Number).filter(Boolean);
    for (const cid of ids) {
      if (body[`remove_${cid}`] === "1") {
        chstore.deleteChannel(cid);
        continue;
      }
      const category = String(body[`category_${cid}`] || "Other");
      const customName = String(body[`custom_name_${cid}`] || "").trim();
      const sourceUrl = String(body[`source_url_${cid}`] || "").trim();
      const sourceLogo = String(body[`source_logo_${cid}`] || "").trim();
      const sourceTvg = String(body[`source_tvg_${cid}`] || "").trim();
      chstore.updateChannel(cid, {
        custom_name: customName,
        category,
        source_url: sourceUrl,
        source_logo: sourceLogo,
        source_tvg_id: sourceTvg,
        enabled: true,
      });
    }

    let layout = null;
    try {
      if (body.layout_json) layout = JSON.parse(String(body.layout_json));
    } catch {
      layout = null;
    }
    if (layout && Array.isArray(layout.cats)) {
      const channelsByCat = layout.channels || {};
      chstore.applyChannelLayout(playlistId, layout.cats, channelsByCat);
    } else if (ordered.length) {
      chstore.reorderCategories(playlistId, ordered);
      if (ids.length) {
        if (cat) chstore.reorderSubset(playlistId, ids);
        else chstore.reorderChannels(playlistId, ids);
      }
    } else if (ids.length) {
      chstore.reorderChannels(playlistId, ids);
    }

    return reply.redirect(channelsNext(playlistId, "Saved", wizard, cat, srcCat));
  });

  app.post("/playlists/:id/channels/api/save-layout", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }
    const body = req.body || {};
    let layout = body.layout;
    if (typeof layout === "string") {
      try {
        layout = JSON.parse(layout);
      } catch {
        layout = null;
      }
    }
    if (!layout || !Array.isArray(layout.cats)) {
      return reply.code(400).send({ ok: false, error: "layout.cats required" });
    }
    chstore.applyChannelLayoutPartial(playlistId, layout.cats, layout.channels || {});
    return reply.send({ ok: true, saved: true });
  });

  app.post("/playlists/:id/channels/api/delete", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }
    const body = req.body || {};
    const cid = Number(body.id || body.channel_id || 0);
    const row = chstore.getChannel(cid);
    if (!row || row.playlist_id !== playlistId) {
      return reply.code(404).send({ ok: false, error: "Channel not found" });
    }
    const payload = publicChannel(row);
    chstore.stashFromPlaylistChannel(row);
    chstore.deleteChannel(cid);
    return reply.send({ ok: true, channel: payload, restorable: true });
  });

  app.post("/playlists/:id/channels/api/delete-category", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }
    const category = String(req.body?.category || "").trim() || "Other";
    const rows = chstore.deleteChannelsByCategory(playlistId, category);
    const channels = rows.map((row) => {
      chstore.stashFromPlaylistChannel(row);
      const payload = publicChannel(row);
      payload.restorable = true;
      return payload;
    });
    return reply.send({ ok: true, category, channels, deleted: channels.length });
  });

  app.post("/playlists/:id/channels/api/create", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }
    const body = req.body || {};
    const name = String(body.name || body.custom_name || "").trim();
    const url = String(body.url || body.source_url || "").trim();
    if (!name) {
      return reply.code(400).send({ ok: false, error: "Name is required" });
    }
    if (!url) {
      return reply.code(400).send({ ok: false, error: "Stream URL is required" });
    }
    const created = chstore.createChannel(playlistId, {
      name,
      url,
      logo: String(body.logo || body.source_logo || "").trim(),
      tvg_id: String(body.tvg_id || body.source_tvg_id || "").trim(),
      category: String(body.category || "").trim() || "Other",
    });
    if (!created) {
      return reply
        .code(409)
        .send({ ok: false, error: "A channel with this stream URL already exists" });
    }
    return reply.send({ ok: true, channel: publicChannel(created) });
  });

  app.post("/playlists/:id/channels/api/update", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }
    const body = req.body || {};
    const cid = Number(body.id || body.channel_id || 0);
    const row = chstore.getChannel(cid);
    if (!row || row.playlist_id !== playlistId) {
      return reply.code(404).send({ ok: false, error: "Channel not found" });
    }
    const fields = {};
    if (body.category != null) {
      fields.category = String(body.category || "Other").trim() || "Other";
    }
    if (body.custom_name != null) {
      fields.custom_name = String(body.custom_name || "").trim();
    }
    if (body.source_url != null) {
      fields.source_url = String(body.source_url || "").trim();
    }
    if (body.source_logo != null) {
      fields.source_logo = String(body.source_logo || "").trim();
    }
    if (body.source_tvg_id != null || body.source_tvg != null) {
      fields.source_tvg_id = String(
        body.source_tvg_id != null ? body.source_tvg_id : body.source_tvg || ""
      ).trim();
    }
    if (Object.keys(fields).length) chstore.updateChannel(cid, fields);
    return reply.send({ ok: true, channel: publicChannel(chstore.getChannel(cid)) });
  });

  app.post("/playlists/:id/channels/api/rename-category", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ ok: false, error: "Unauthorized" });
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      return reply.code(403).send({ ok: false, error: "Forbidden" });
    }
    const from = String(req.body?.from || "").trim();
    const to = String(req.body?.to || "").trim();
    if (!from || !to) {
      return reply.code(400).send({ ok: false, error: "from and to are required" });
    }
    const n = chstore.renameCategory(playlistId, from, to);
    return reply.send({ ok: true, from, to, updated: n });
  });

  app.post("/playlists/:id/channels/import-csv", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    let text = String(body.csv_text || "").trim();
    if (!text && req.body?.csv_file?.type === "file") {
      const buf = await req.body.csv_file.toBuffer();
      text = buf.toString("utf8");
    }
    // multipart flattened: file may remain as object on body from index hook only for wizard
    const fileField = body.csv_file;
    if (!text && fileField && typeof fileField === "object" && fileField.toBuffer) {
      text = (await fileField.toBuffer()).toString("utf8");
    }
    if (!text) {
      return reply.redirect(
        channelsNext(playlistId, "No+CSV+provided", wizard)
      );
    }
    let source = [];
    try {
      source = await loadSourceChannels(pl);
    } catch {
      source = [];
    }
    const result = chstore.importChannelsCsv(playlistId, text, source);
    const msg = `CSV+import+updated+${result.updated}+added+${result.added}` +
      (result.removed ? `+removed+${result.removed}` : "") +
      (result.missing.length ? `+missing+${result.missing.length}` : "");
    return reply.redirect(channelsNext(playlistId, msg, wizard));
  });

  app.post("/playlists/:id/channels/quality", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    const picked = formList(body, "quality");
    const qf = picked.join(",");
    const dedupe = body.dedupe_by_name === "1";
    const prefer = body.prefer_quality || "best";
    updatePlaylist(playlistId, {
      quality_filter: qf,
      dedupe_by_name: dedupe,
      prefer_quality: prefer,
    });
    const n = chstore.applyQualityAndDedupe(playlistId, {
      qualityFilter: qf,
      preferQuality: prefer,
      dedupeByName: dedupe,
    });
    return reply.redirect(
      channelsNext(
        playlistId,
        `Quality+applied+removed+${n}`,
        wizard,
        body.cat,
        body.src_cat
      )
    );
  });

  app.post("/playlists/:id/channels/add", async (req, reply) => {
    const user = currentUser(req);
    if (!user) {
      if (wantsJson(req)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
      return reply.redirect("/login");
    }
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) {
      if (wantsJson(req)) return reply.code(403).send({ ok: false, error: "Forbidden" });
      return reply.redirect("/");
    }
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    const picks = formList(body, "pick");
    const srcCats = formList(body, "src_cats")
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    const source = await loadSourceChannels(pl);
    const byKey = new Map(source.map((c) => [`${c.tvg_id}||${c.url}`, c]));
    const pickKeys = new Set(picks.filter((raw) => raw.includes("||")));

    // Expand selected source categories into channel picks
    if (srcCats.length) {
      const selected = chstore.listChannels(playlistId);
      const allowedQ = parseQualityFilter(pl.quality_filter);
      const { remainingByCat } = buildRemainingByCat(
        playlistId,
        source,
        selected,
        "",
        allowedQ
      );
      for (const cat of srcCats) {
        for (const s of remainingByCat[cat] || []) {
          pickKeys.add(`${s.tvg_id || ""}||${s.url || ""}`);
        }
      }
    }

    const addedChannels = [];
    for (const raw of pickKeys) {
      if (!raw.includes("||")) continue;
      const tvg = raw.split("||")[0];
      const url = raw.split("||").slice(1).join("||");
      // Prefer stash restore so deleted channels keep their saved id + edits
      const stashed = chstore.findStashEntry(playlistId, tvg, url);
      if (stashed) {
        const row = chstore.restoreStashedChannel(playlistId, tvg, url);
        if (row) addedChannels.push(publicChannel(row));
        continue;
      }
      let ch = byKey.get(raw);
      if (!ch) {
        ch = source.find((c) => c.url === url);
      }
      if (ch) {
        const row = chstore.addFromSourceChannel(playlistId, ch);
        if (row) addedChannels.push(publicChannel(row));
      }
    }
    if (wantsJson(req)) {
      return reply.send({
        ok: true,
        added: addedChannels.length,
        channels: addedChannels,
      });
    }
    return reply.redirect(
      channelsNext(
        playlistId,
        `Added+${addedChannels.length}+channel(s)`,
        wizard,
        body.cat,
        body.src_cat
      )
    );
  });

  app.post("/playlists/:id/channels/reset", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    try {
      const source = await loadSourceChannels(pl);
      chstore.clearChannels(playlistId);
      chstore.clearStash(playlistId);
      const added = chstore.importAllFromSource(
        playlistId,
        source,
        pl.quality_filter || ""
      );
      return reply.redirect(
        channelsNext(playlistId, `Reset+to+source+${added}+channels`, wizard)
      );
    } catch (e) {
      return reply.redirect(
        channelsNext(
          playlistId,
          `Error+${String(e.message || e).slice(0, 80)}`,
          wizard
        )
      );
    }
  });

  app.post("/playlists/:id/channels/import-all", async (req, reply) => {
    // Does not modify Your list — new source channels appear under Add from source.
    // Only Reset replaces Your list from source.
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    return reply.redirect(
      channelsNext(
        playlistId,
        "Source+updated+—+new+channels+are+in+Add+from+source",
        wizard,
        body.cat,
        body.src_cat
      )
    );
  });

  app.post("/playlists/:id/channels/revert-categories", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    const pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const body = req.body || {};
    const wizard = ["1", "true", "yes"].includes(String(body.wizard || ""));
    let n = 0;
    for (const r of chstore.listChannels(playlistId)) {
      const cat = r.source_group
        ? (await import("../services/categories.js")).categoryFromSourceGroup(
            r.source_group
          )
        : "Other";
      if (cat !== r.category) {
        chstore.updateChannel(r.id, { category: cat });
        n += 1;
      }
    }
    return reply.redirect(
      channelsNext(playlistId, `Reverted+${n}+categories+from+source`, wizard, body.cat)
    );
  });

  app.get("/playlists/:id/channels/export.csv", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const rows = chstore.listChannels(pl.id);
    const lines = ["position,name,category,tvg_id,enabled,url"];
    for (const r of rows) {
      const name = (r.custom_name || r.source_name || "").replace(/"/g, '""');
      lines.push(
        `${r.position},"${name}","${r.category}","${r.source_tvg_id}",${r.enabled},"${r.source_url}"`
      );
    }
    reply.header("Content-Type", "text/csv");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${pl.slug}-channels.csv"`
    );
    return reply.send(lines.join("\n"));
  });
}
