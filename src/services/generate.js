import fs from "node:fs";
import path from "node:path";
import {
  getPlaylist,
  updatePlaylist,
  loadSourceChannels,
  outputPaths,
  publicUrls,
} from "./playlists.js";
import { getUserById } from "./auth.js";
import * as chstore from "./channels.js";
import {
  dedupeChannelsByName,
  buildM3u,
  channelMatchesQuality,
  parseQualityFilter,
} from "./m3u.js";
import * as jobprog from "./progress.js";
import { resolveEpgHeaderUrl } from "./epgLink.js";

const locks = new Map();

export async function generatePlaylist(playlistId, { jobId = null } = {}) {
  if (locks.get(playlistId)) {
    if (jobId) jobprog.appendLog(jobId, "Waiting for in-progress generate…");
    await locks.get(playlistId);
    return generatePlaylist(playlistId, { jobId });
  }
  let release;
  const p = new Promise((r) => {
    release = r;
  });
  locks.set(playlistId, p);
  try {
    return await generateLocked(playlistId, jobId);
  } finally {
    locks.delete(playlistId);
    release();
  }
}

async function generateLocked(playlistId, jobId) {
  const pl = getPlaylist(playlistId);
  if (!pl) throw new Error("Playlist not found");
  const user = getUserById(pl.user_id);
  if (!user) throw new Error("User not found");

  const steps = [
    "Loading channel list",
    "Fetching source M3U",
    "Matching channels",
    "Building playlist",
    "Writing files",
  ];
  const tick = (idx, pct, detail, extra = {}) => {
    if (jobId) jobprog.advance(jobId, idx, pct, detail, extra);
  };

  try {
    tick(0, 5, "Reading channel selections from database");
    let selected = chstore.listChannels(playlistId);
    if (jobId) {
      jobprog.appendLog(
        jobId,
        `Playlist #${playlistId} “${pl.name}” slug=${pl.slug} rows=${selected.length}`
      );
    }
    // Do not seed/overwrite Your list here — only Reset rebuilds from source.
    // Empty list generates an empty M3U until channels are added manually.

    tick(1, 20, "Fetching source M3U");
    const source = await loadSourceChannels(pl);
    if (jobId) jobprog.appendLog(jobId, `Loaded ${source.length} source streams`);

    tick(2, 40, `Matching against ${source.length} source streams`);
    const enabledN = chstore.listChannels(playlistId, true).length;
    if (jobId) {
      jobprog.appendLog(jobId, `Resolving ${enabledN} enabled channel(s)…`);
      jobprog.updateJob(jobId, {
        items_done: 0,
        items_total: enabledN,
        silent: true,
      });
    }

    const onChannel = (i, total, name, status) => {
      if (!jobId) return;
      const label = String(name || "—").replace(/\n/g, " ").slice(0, 80);
      jobprog.appendLog(
        jobId,
        `[${i}/${total}] ${status === "ok" ? "OK " : "MISS"} ${label}`
      );
      const pct = 40 + Math.floor((i / Math.max(total, 1)) * 30);
      tick(2, pct, `Channel ${i}/${total}: ${label}`, {
        silent: true,
        items_done: i,
        items_total: total,
      });
    };

    let { output: outputChannels, unresolved } =
      chstore.resolveChannelsForOutput(
        playlistId,
        source,
        jobId ? onChannel : null
      );

    if (jobId) {
      jobprog.appendLog(
        jobId,
        `Matched ${outputChannels.length}; unresolved=${unresolved.length}`
      );
    }

    const qf = pl.quality_filter || "";
    const doDedupe = pl.dedupe_by_name == null ? true : Boolean(pl.dedupe_by_name);
    const before = outputChannels.length;
    if (doDedupe) {
      outputChannels = dedupeChannelsByName(outputChannels, {
        preferQuality: pl.prefer_quality || "best",
        qualityFilter: qf || null,
      });
    } else {
      const allowed = parseQualityFilter(qf);
      const seenUrl = new Set();
      outputChannels = outputChannels.filter((c) => {
        const u = (c.url || "").trim();
        if (u && seenUrl.has(u)) return false;
        if (u) seenUrl.add(u);
        return channelMatchesQuality(c, allowed);
      });
    }
    if (jobId && before !== outputChannels.length) {
      jobprog.appendLog(
        jobId,
        `Quality/dedupe: ${before} → ${outputChannels.length}`
      );
    }

    tick(3, 75, `Preparing ${outputChannels.length} channels`);

    const urls = publicUrls(user.username, pl.slug);
    const paths = outputPaths(user.username, pl.slug);
    const headerEpg = resolveEpgHeaderUrl(pl);

    if (jobId) {
      jobprog.appendLog(
        jobId,
        `Writing playlist.m3u (${outputChannels.length} channels)…`
      );
      for (let i = 0; i < outputChannels.length; i++) {
        const ch = outputChannels[i];
        const nm = String(ch.name || "—").replace(/\n/g, " ").slice(0, 70);
        if (i % 25 === 0 || i === outputChannels.length - 1) {
          jobprog.appendLog(
            jobId,
            `[${i + 1}/${outputChannels.length}] write ${nm}`
          );
          tick(4, 85 + Math.floor(((i + 1) / Math.max(outputChannels.length, 1)) * 10), nm, {
            silent: true,
            items_done: i + 1,
            items_total: outputChannels.length,
          });
        }
      }
    }

    const m3uText = buildM3u(outputChannels, headerEpg);
    fs.writeFileSync(paths.m3u, m3uText, "utf8");

    updatePlaylist(playlistId, {
      last_generated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      last_status: "ok",
      last_error: "",
      matched_count: outputChannels.length,
      missing_count: unresolved.length,
    });

    if (jobId) {
      const job = jobprog.getJob(jobId);
      jobprog.appendLog(
        jobId,
        `Summary: matched=${outputChannels.length} unresolved=${unresolved.length}` +
          (job ? ` elapsed=${job.elapsed_label}` : "")
      );
      jobprog.finish(jobId, {
        playlist_id: playlistId,
        matched: outputChannels.length,
      });
    }

    return {
      ...getPlaylist(playlistId),
      urls,
      unresolved,
    };
  } catch (exc) {
    updatePlaylist(playlistId, {
      last_status: "error",
      last_error: String(exc).slice(0, 500),
    });
    if (jobId) {
      jobprog.appendLog(jobId, `Trace: ${exc?.name || "Error"}: ${exc.message || exc}`);
      jobprog.fail(jobId, String(exc.message || exc));
    }
    throw exc;
  }
}

export async function generateAll() {
  const results = [];
  for (const pl of (await import("./playlists.js")).listEnabledPlaylists()) {
    try {
      results.push(await generatePlaylist(pl.id));
    } catch (exc) {
      results.push({ id: pl.id, error: String(exc.message || exc) });
    }
  }
  return results;
}

export async function generateAllForUser(userId) {
  const results = [];
  const { listEnabledPlaylistsForUser } = await import("./playlists.js");
  for (const pl of listEnabledPlaylistsForUser(userId)) {
    try {
      results.push(await generatePlaylist(pl.id));
    } catch (exc) {
      results.push({ id: pl.id, error: String(exc.message || exc) });
    }
  }
  return results;
}
