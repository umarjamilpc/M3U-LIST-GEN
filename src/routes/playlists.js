import fs from "node:fs";
import path from "node:path";
import { currentUser } from "./auth.js";
import {
  createPlaylist,
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
  canAccessPlaylist,
  uploadsDir,
  draftUploadsDir,
  listUploadedM3u,
  listDraftUploadedM3u,
  clearDraftUploads,
  moveDraftUploadsToPlaylist,
  publicUrls,
  resolvePublicBase,
  serializeSourceModes,
  parseSourceModes,
  normalizeEpgUrls,
  customM3uUrls,
  findIncompletePlaylist,
  markPlaylistSetupComplete,
} from "../services/playlists.js";
import {
  getPlaylistDraft,
  draftAsPlaylist,
  savePlaylistDraft,
  clearPlaylistDraft,
} from "../services/wizardDraft.js";
import { getUserById } from "../services/auth.js";
import { listCountries } from "../services/iptvorg.js";
import { defaultMergedEpgUrl } from "../services/epgLink.js";
import { EPG_LIST_GEN_BASE } from "../config.js";
import * as settings from "../services/settings.js";
import { createJob } from "../services/progress.js";
import { generatePlaylist } from "../services/generate.js";

export const WIZARD_STEPS = [
  "name",
  "source",
  "guide",
  "channels",
  "generate",
];

const DRAFT_STEPS = new Set(["name", "source", "guide"]);

function formList(body, key) {
  const v = body?.[key];
  const unwrap = (x) => {
    if (x == null) return "";
    if (typeof x === "object" && "value" in x) return String(x.value ?? "");
    if (typeof x === "object" && x.type === "file") return "";
    return String(x);
  };
  if (Array.isArray(v)) return v.map(unwrap).map((s) => s.trim()).filter(Boolean);
  if (v == null || v === "") return [];
  const s = unwrap(v).trim();
  return s ? [s] : [];
}

function wizardCtx(pl, step, extra = {}) {
  const stepOrder = WIZARD_STEPS;
  const stepI = Math.max(0, stepOrder.indexOf(step));
  const prevStep = stepI > 0 ? stepOrder[stepI - 1] : null;
  const nextStep =
    stepI < stepOrder.length - 1 ? stepOrder[stepI + 1] : null;
  return {
    playlist: pl,
    wizard_step: step,
    prev_step: prevStep,
    next_step: nextStep,
    defaults: {
      countries: "US",
    },
    ...extra,
  };
}

function postedSourceM3uUrl(body) {
  if (Array.isArray(body.source_m3u_url)) {
    return body.source_m3u_url
      .map((x) =>
        x && typeof x === "object" && "value" in x
          ? String(x.value ?? "")
          : String(x ?? "")
      )
      .join("\n");
  }
  if (
    body.source_m3u_url &&
    typeof body.source_m3u_url === "object" &&
    "value" in body.source_m3u_url
  ) {
    return String(body.source_m3u_url.value ?? "");
  }
  return String(body.source_m3u_url || "");
}

function buildSourcePatch(body, prev, { userId = null, m3uUploaded = false } = {}) {
  let modes = formList(body, "source_mode").filter((m) =>
    ["iptvorg", "urls", "uploads"].includes(m)
  );
  if (!modes.length) {
    modes = [...parseSourceModes(prev.source_modes)];
  }
  if (m3uUploaded && !modes.includes("uploads")) {
    modes.push("uploads");
  }
  const onDisk = userId
    ? listDraftUploadedM3u(userId)
    : prev.id
      ? listUploadedM3u(prev.id)
      : [];
  if (onDisk.length && !modes.includes("uploads")) {
    modes.push("uploads");
  }
  const wantIptv = modes.includes("iptvorg");
  const wantUrls = modes.includes("urls");
  let countriesList = wantIptv
    ? formList(body, "countries")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
    : [];
  if (wantIptv && !countriesList.length) {
    countriesList = String(prev.countries || "")
      .split(/\s+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
  }
  if (wantIptv && !countriesList.length) {
    const fallback = String(settings.getSetting("default_countries") || "US")
      .split(/\s+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));
    countriesList = fallback.length ? fallback : ["US"];
  }
  const countries = countriesList.join(" ");
  const prevCustom = customM3uUrls(prev.source_m3u_url, {
    skipCountryUrls: true,
  }).join("\n");
  const rawUrl = wantUrls ? postedSourceM3uUrl(body) : prevCustom;
  const primaryCat = (countriesList[0] || "").trim().toUpperCase();
  const patch = {
    source_modes: serializeSourceModes(modes),
    countries: wantIptv ? countries : "",
    source_m3u_url: rawUrl,
  };
  if (primaryCat) patch.epg_category = primaryCat;
  return patch;
}

function materializeDraftPlaylist(user, draft, reply, req) {
  const modes = serializeSourceModes(draft.source_modes || "iptvorg");
  const modeSet = parseSourceModes(modes);
  if (listDraftUploadedM3u(user.id).length) {
    modeSet.add("uploads");
  }
  const pl = createPlaylist(user.id, {
    name: draft.name,
    slug: draft.slug,
    source_modes: serializeSourceModes(modeSet),
    countries: draft.countries || "",
    source_m3u_url: draft.source_m3u_url || "",
    epg_url: draft.epg_url || "",
    epg_category: draft.epg_category || "US",
    m3u_include_epg:
      draft.m3u_include_epg == null ? true : Boolean(draft.m3u_include_epg),
    enabled: true,
    setup_complete: 0,
  });
  const n = moveDraftUploadsToPlaylist(user.id, pl.id);
  if (n > 0) {
    const m = parseSourceModes(pl.source_modes);
    m.add("uploads");
    updatePlaylist(pl.id, { source_modes: serializeSourceModes(m) });
  }
  clearPlaylistDraft(reply, req);
  return getPlaylist(pl.id);
}

export default async function playlistRoutes(app) {
  // ——— Session draft wizard (no playlist row yet) ———

  app.get("/playlists/new/cancel", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    clearPlaylistDraft(reply, req);
    clearDraftUploads(user.id);
    return reply.redirect("/");
  });

  app.get("/playlists/new", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const incomplete = findIncompletePlaylist(user.id);
    if (incomplete) {
      return reply.redirect(
        `/playlists/${incomplete.id}/wizard/name?msg=${encodeURIComponent(
          "Continue setup — this playlist is not on the dashboard until you finish Generate."
        )}`
      );
    }
    const draft = getPlaylistDraft(req.session);
    const countries = await listCountries().catch(() => []);
    return reply.view(
      "playlist_form.ejs",
      wizardCtx(draftAsPlaylist(draft), "name", {
        title: draft?.name || "New playlist",
        user,
        countries,
        uploaded_m3u: listDraftUploadedM3u(user.id),
        message: null,
        error: null,
        is_draft: true,
      })
    );
  });

  app.post("/playlists/new", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) {
      const countries = await listCountries().catch(() => []);
      return reply.view(
        "playlist_form.ejs",
        wizardCtx(draftAsPlaylist(getPlaylistDraft(req.session)), "name", {
          title: "New playlist",
          user,
          countries,
          uploaded_m3u: listDraftUploadedM3u(user.id),
          message: null,
          error: "Name is required",
          is_draft: true,
        })
      );
    }
    savePlaylistDraft(reply, req, {
      name,
      slug: String(body.slug || name).trim(),
    });
    return reply.redirect("/playlists/new/wizard/source");
  });

  app.get("/playlists/new/wizard/:step", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    let step = String(req.params.step || "name");
    if (step === "name") return reply.redirect("/playlists/new");
    if (!DRAFT_STEPS.has(step)) {
      return reply.redirect("/playlists/new");
    }
    const draft = getPlaylistDraft(req.session);
    if (!draft?.name) return reply.redirect("/playlists/new");
    const countries = await listCountries().catch(() => []);
    return reply.view(
      "playlist_form.ejs",
      wizardCtx(draftAsPlaylist(draft), step, {
        title: draft.name,
        user,
        countries,
        uploaded_m3u: listDraftUploadedM3u(user.id),
        message: req.query.msg || null,
        error: req.query.err || null,
        is_draft: true,
        default_epg_url: defaultMergedEpgUrl(
          draft.epg_category ||
            String(draft.countries || "")
              .trim()
              .split(/\s+/)[0] ||
            "US"
        ),
        epg_base: (
          settings.getSetting("epg_list_gen_base") || EPG_LIST_GEN_BASE
        ).replace(/\/$/, ""),
      })
    );
  });

  app.post("/playlists/new/wizard/:step", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    let step = String(req.params.step || "source");
    if (step === "name") {
      // handled by POST /playlists/new; keep for form safety
      return reply.redirect("/playlists/new");
    }
    if (!DRAFT_STEPS.has(step)) return reply.redirect("/playlists/new");

    let draft = getPlaylistDraft(req.session);
    if (!draft?.name) return reply.redirect("/playlists/new");

    if (req.uploadError) {
      return reply.redirect(
        `/playlists/new/wizard/${step}?err=${encodeURIComponent(req.uploadError)}`
      );
    }

    const body = req.body || {};
    const action = String(body.wizard_action || "next").toLowerCase();
    const stepI = WIZARD_STEPS.indexOf(step);
    const goingBack = action === "back" && stepI > 0;
    const gotoStep = String(body.wizard_goto || "").trim();

    if (step === "source") {
      const patch = buildSourcePatch(body, draftAsPlaylist(draft), {
        userId: user.id,
        m3uUploaded: Boolean(req.m3uUploaded),
      });
      savePlaylistDraft(reply, req, patch);
      draft = { ...draft, ...patch };
    } else if (step === "guide") {
      const patch = {
        epg_url: normalizeEpgUrls(body.epg_url || ""),
        epg_category: String(body.epg_category || "").trim() || "US",
        m3u_include_epg:
          body.m3u_include_epg === "1" || body.m3u_include_epg === "on",
      };
      savePlaylistDraft(reply, req, patch);
      draft = { ...draft, ...patch };
    }

    if (goingBack) {
      const prev = WIZARD_STEPS[stepI - 1];
      if (prev === "name") return reply.redirect("/playlists/new");
      return reply.redirect(`/playlists/new/wizard/${prev}`);
    }

    if (gotoStep && DRAFT_STEPS.has(gotoStep)) {
      if (gotoStep === "name") return reply.redirect("/playlists/new");
      return reply.redirect(`/playlists/new/wizard/${gotoStep}`);
    }

    if (action === "next") {
      const next = WIZARD_STEPS[stepI + 1];
      if (next === "channels") {
        const pl = materializeDraftPlaylist(user, draft, reply, req);
        return reply.redirect(`/playlists/${pl.id}/channels?wizard=1`);
      }
      if (next && DRAFT_STEPS.has(next)) {
        return reply.redirect(`/playlists/new/wizard/${next}`);
      }
    }
    return reply.redirect(`/playlists/new/wizard/${step}`);
  });

  app.post("/playlists/new/uploads/m3u/delete", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const name = path.basename(String(req.body?.filename || ""));
    if (name && /\.(m3u8?|txt)$/i.test(name)) {
      const fp = path.join(draftUploadsDir(user.id), "m3u", name);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    return reply.redirect("/playlists/new/wizard/source");
  });

  // ——— Existing playlist wizard ———

  app.get("/playlists/:id/wizard/:step", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    let pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    let step = String(req.params.step || "name");
    if (step === "channels") {
      return reply.redirect(`/playlists/${pl.id}/channels?wizard=1`);
    }
    if (step === "filtering") {
      return reply.redirect(`/playlists/${pl.id}/channels?wizard=1`);
    }
    if (!WIZARD_STEPS.includes(step)) step = "name";
    if (step === "source") {
      const modes = parseSourceModes(pl.source_modes);
      let dirty = false;
      if (customM3uUrls(pl.source_m3u_url, { skipCountryUrls: true }).length && !modes.has("urls")) {
        modes.add("urls");
        dirty = true;
      }
      if (listUploadedM3u(pl.id).length && !modes.has("uploads")) {
        modes.add("uploads");
        dirty = true;
      }
      if (dirty) {
        updatePlaylist(pl.id, { source_modes: serializeSourceModes(modes) });
        pl = getPlaylist(pl.id);
      }
    }
    const countries = await listCountries().catch(() => []);
    const owner = getUserById(pl.user_id);
    const base = resolvePublicBase(req);
    return reply.view(
      "playlist_form.ejs",
      wizardCtx(pl, step, {
        title: pl.name,
        user,
        countries,
        uploaded_m3u: listUploadedM3u(pl.id),
        message: req.query.msg || null,
        error: req.query.err || null,
        public_urls: publicUrls(owner.username, pl.slug, base),
        default_epg_url: defaultMergedEpgUrl(
          pl.epg_category ||
            String(pl.countries || "")
              .trim()
              .split(/\s+/)[0] ||
            "US"
        ),
        epg_base: (
          settings.getSetting("epg_list_gen_base") || EPG_LIST_GEN_BASE
        ).replace(/\/$/, ""),
        is_draft: false,
      })
    );
  });

  app.post("/playlists/:id/wizard/:step", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const playlistId = Number(req.params.id);
    let pl = getPlaylist(playlistId);
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const step = String(req.params.step || "name");
    if (step === "filtering" || step === "channels") {
      return reply.redirect(`/playlists/${playlistId}/channels?wizard=1`);
    }
    const body = req.body || {};
    const action = String(body.wizard_action || "next").toLowerCase();
    const stepI = WIZARD_STEPS.indexOf(step);

    if (req.uploadError) {
      return reply.redirect(
        `/playlists/${playlistId}/wizard/${step}?err=${encodeURIComponent(req.uploadError)}`
      );
    }

    const goingBack = action === "back" && stepI > 0;
    const gotoStep = String(body.wizard_goto || "").trim();

    if (step === "name") {
      updatePlaylist(playlistId, {
        name: body.name,
        slug: body.slug,
        enabled: body.enabled === "1" || body.enabled === "on",
      });
    } else if (step === "source") {
      updatePlaylist(
        playlistId,
        buildSourcePatch(body, pl, {
          m3uUploaded: Boolean(req.m3uUploaded),
        })
      );
    } else if (step === "guide") {
      updatePlaylist(playlistId, {
        epg_url: normalizeEpgUrls(body.epg_url || ""),
        epg_category: String(body.epg_category || "").trim(),
        epg_match_csv_url: "",
        epg_upload_path: "",
        align_tvg_ids: false,
        m3u_include_epg:
          body.m3u_include_epg === "1" || body.m3u_include_epg === "on",
      });
    }

    pl = getPlaylist(playlistId);

    if (goingBack) {
      const prev = WIZARD_STEPS[stepI - 1];
      if (prev === "channels") {
        return reply.redirect(`/playlists/${playlistId}/channels?wizard=1`);
      }
      return reply.redirect(`/playlists/${playlistId}/wizard/${prev}`);
    }

    if (gotoStep && WIZARD_STEPS.includes(gotoStep)) {
      if (gotoStep === "channels") {
        return reply.redirect(`/playlists/${playlistId}/channels?wizard=1`);
      }
      return reply.redirect(`/playlists/${playlistId}/wizard/${gotoStep}`);
    }

    if (action === "generate" || (action === "next" && step === "generate")) {
      markPlaylistSetupComplete(playlistId);
      clearPlaylistDraft(reply, req);
      clearDraftUploads(user.id);
      const jobId = createJob(`Generate ${pl.name}`, [
        "Loading channel list",
        "Fetching source M3U",
        "Matching channels",
        "Building playlist",
        "Writing files",
      ]);
      setImmediate(() => {
        generatePlaylist(playlistId, { jobId }).catch(() => {});
      });
      return reply.redirect(`/jobs/${jobId}?next=/`);
    }

    if (action === "next") {
      const next = WIZARD_STEPS[stepI + 1];
      if (next === "channels") {
        return reply.redirect(`/playlists/${playlistId}/channels?wizard=1`);
      }
      if (next) return reply.redirect(`/playlists/${playlistId}/wizard/${next}`);
    }
    return reply.redirect(`/playlists/${playlistId}/wizard/${step}`);
  });

  app.post("/playlists/:id/uploads/m3u/delete", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    const name = path.basename(String(req.body?.filename || ""));
    if (name && /\.(m3u8?|txt)$/i.test(name)) {
      const fp = path.join(uploadsDir(pl.id), "m3u", name);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    return reply.redirect(`/playlists/${pl.id}/wizard/source`);
  });

  app.post("/playlists/:id/uploads/m3u", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    try {
      const {
        streamUploadToDisk,
        assertUploadAllowed,
        assertFileWithinLimits,
      } = await import("../services/quotas.js");
      const { parseSourceModes, serializeSourceModes } = await import(
        "../services/playlists.js"
      );
      assertUploadAllowed(user, { kind: "m3u", sizeBytes: 0 });
      const data = await req.file();
      if (data) {
        const dir = path.join(uploadsDir(pl.id), "m3u");
        let name = path.basename(data.filename || "upload.m3u");
        if (!/\.(m3u8?|txt)$/i.test(name)) name += ".m3u";
        const dest = path.join(dir, name);
        const field = {
          type: "file",
          file: data.file,
          toBuffer: data.toBuffer?.bind(data),
        };
        const n = await streamUploadToDisk(field, dest);
        if (n) {
          assertFileWithinLimits(user, dest, "m3u");
          const modes = parseSourceModes(pl.source_modes);
          modes.add("uploads");
          updatePlaylist(pl.id, { source_modes: serializeSourceModes(modes) });
        }
      }
      return reply.redirect(`/playlists/${pl.id}/wizard/source`);
    } catch (e) {
      return reply.redirect(
        `/playlists/${pl.id}/wizard/source?err=${encodeURIComponent(String(e.message || e))}`
      );
    }
  });

  app.post("/playlists/:id/generate", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    if (!pl.setup_complete) markPlaylistSetupComplete(pl.id);
    const jobId = createJob(`Regenerate ${pl.name}`);
    setImmediate(() => {
      generatePlaylist(pl.id, { jobId }).catch(() => {});
    });
    return reply.redirect(`/jobs/${jobId}?next=/`);
  });

  app.post("/playlists/:id/delete", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const pl = getPlaylist(Number(req.params.id));
    if (!canAccessPlaylist(pl, user)) return reply.redirect("/");
    deletePlaylist(pl.id);
    clearPlaylistDraft(reply, req);
    clearDraftUploads(user.id);
    return reply.redirect("/");
  });

  app.get("/playlists/:id/edit", async (req, reply) => {
    return reply.redirect(`/playlists/${req.params.id}/wizard/name`);
  });

  app.post("/generate-all", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const jobId = createJob("Refresh all playlists");
    setImmediate(async () => {
      try {
        const { listEnabledPlaylists } = await import("../services/playlists.js");
        const { generatePlaylist } = await import("../services/generate.js");
        const { appendLog, finish, fail } = await import("../services/progress.js");
        const list = listEnabledPlaylists();
        appendLog(jobId, `${list.length} enabled playlist(s)`);
        for (const pl of list) {
          appendLog(jobId, `Generating ${pl.name}…`);
          await generatePlaylist(pl.id);
        }
        finish(jobId);
      } catch (e) {
        const { fail } = await import("../services/progress.js");
        fail(jobId, e.message || e);
      }
    });
    return reply.redirect(`/jobs/${jobId}?next=/`);
  });
}
