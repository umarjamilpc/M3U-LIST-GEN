import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import ejs from "ejs";
import cron from "node-cron";

import { PORT, SECRET_KEY, DATA_DIR } from "./config.js";
import { initDb, closeDb } from "./db/schema.js";
import { sessionPlugin } from "./services/session.js";
import { generatePlaylist } from "./services/generate.js";
import { createJob, appendLog } from "./services/progress.js";
import { wallClockInTz } from "./services/userSettings.js";
import {
  listEnabledPlaylists,
  updatePlaylist,
  cleanupOrphanPlaylistData,
} from "./services/playlists.js";
import {
  streamUploadToDisk,
  assertUploadAllowed,
  assertFileWithinLimits,
  maxUploadBytes,
} from "./services/quotas.js";
import { currentUser } from "./routes/auth.js";

import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import playlistRoutes from "./routes/playlists.js";
import channelRoutes from "./routes/channels.js";
import jobRoutes from "./routes/jobs.js";
import settingsRoutes from "./routes/settings.js";
import userRoutes from "./routes/users.js";
import storageRoutes from "./routes/storage.js";
import publicRoutes from "./routes/public.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Normalize multipart attachFieldsToBody values into plain strings / arrays */
function flattenBody(body) {
  if (!body || typeof body !== "object") return body || {};
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    if (typeof v === "object" && v.type === "file") {
      out[k] = v;
      continue;
    }
    if (typeof v === "object" && "value" in v) {
      out[k] = v.value;
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object" && "value" in item ? item.value : item
      );
      continue;
    }
    out[k] = v;
  }
  return out;
}

async function saveUploadFromBody(fileField, destPath, user, kind) {
  if (!fileField) return false;
  const fname = String(fileField.filename || "").trim();
  // Empty file picker — skip quietly
  if (fileField.type === "file" && !fname) return false;
  assertUploadAllowed(user, { kind, sizeBytes: 0 });
  const written = await streamUploadToDisk(fileField, destPath);
  if (!written) {
    if (fname) {
      throw new Error(
        `Upload “${fname}” could not be saved (empty or unreadable). Try again.`
      );
    }
    return false;
  }
  assertFileWithinLimits(user, destPath, kind);
  return true;
}

async function main() {
  initDb();
  try {
    cleanupOrphanPlaylistData({ vacuum: false });
  } catch (e) {
    console.warn("Orphan playlist cleanup skipped:", e?.message || e);
  }

  const app = Fastify({
    logger: true,
    // Honour X-Forwarded-* from Nginx Proxy Manager / reverse proxies
    trustProxy: true,
    // High ceiling; per-type limits enforced in quotas after stream-to-disk
    bodyLimit: 100 * 1024 * 1024,
  });

  await app.register(fastifyCookie, { secret: SECRET_KEY });
  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: { fileSize: Math.max(maxUploadBytes("m3u"), maxUploadBytes("epg"), 80 * 1024 * 1024) },
  });
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/static/",
  });
  await app.register(fastifyView, {
    engine: { ejs },
    root: path.join(__dirname, "views"),
    layout: "layout.ejs",
    defaultContext: { title: "M3U-LIST-GEN" },
    options: {
      filename: path.join(__dirname, "views"),
    },
  });

  sessionPlugin(app);

  app.addHook("preHandler", async (req) => {
    if (req.body && typeof req.body === "object") {
      req.body = flattenBody(req.body);
    }
  });

  // Handle optional M3U uploads on wizard source step (playlist or session draft)
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST" || !req.body) return;
    const url = String(req.url || "").split("?")[0];
    const playlistMatch = url.match(/^\/playlists\/(\d+)\/wizard\/source$/);
    const draftMatch = url === "/playlists/new/wizard/source";
    if (!playlistMatch && !draftMatch) return;

    const user = currentUser(req);
    if (!user) return;
    const {
      uploadsDir,
      draftUploadsDir,
      getPlaylist,
      canAccessPlaylist,
      parseSourceModes,
      listUploadedM3u,
      listDraftUploadedM3u,
    } = await import("./services/playlists.js");

    let uploadRoot;
    let priorModes = ["iptvorg"];
    let onDiskFn = () => [];

    if (playlistMatch) {
      const playlistId = Number(playlistMatch[1]);
      const pl = getPlaylist(playlistId);
      if (!canAccessPlaylist(pl, user)) return;
      uploadRoot = uploadsDir(playlistId);
      priorModes = [...parseSourceModes(pl.source_modes)];
      onDiskFn = () => listUploadedM3u(playlistId);
    } else {
      uploadRoot = draftUploadsDir(user.id);
      onDiskFn = () => listDraftUploadedM3u(user.id);
    }

    try {
      const files = [];
      if (req.body.m3u_file) {
        if (Array.isArray(req.body.m3u_file)) files.push(...req.body.m3u_file);
        else files.push(req.body.m3u_file);
      }
      let saved = 0;
      let attempted = 0;
      for (const file of files) {
        if (!file) continue;
        const fname = String(file.filename || "").trim();
        if (file.type === "file" && !fname) continue;
        if (file.type !== "file" && typeof file.toBuffer !== "function") continue;
        attempted += 1;
        const dir = path.join(uploadRoot, "m3u");
        let name = path.basename(fname || "upload.m3u");
        if (!/\.(m3u8?|txt)$/i.test(name)) name += ".m3u";
        if (await saveUploadFromBody(file, path.join(dir, name), user, "m3u")) {
          saved += 1;
        }
      }
      delete req.body.m3u_file;
      req.m3uUploaded = saved > 0;

      if (attempted > 0 && saved === 0) {
        throw new Error(
          "M3U upload did not save. Pick a .m3u / .m3u8 file and try again."
        );
      }

      const onDisk = onDiskFn();
      if (saved > 0 || onDisk.length) {
        const posted = req.body.source_mode;
        const list = Array.isArray(posted)
          ? posted.map(String)
          : posted
            ? [String(posted)]
            : [...priorModes];
        if (!list.includes("uploads")) list.push("uploads");
        req.body.source_mode = list;
      }
    } catch (e) {
      req.uploadError = String(e.message || e);
      reply.header(
        "x-upload-error",
        encodeURIComponent(String(e.message || e).slice(0, 180))
      );
    }
  });

  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(playlistRoutes);
  await app.register(channelRoutes);
  await app.register(jobRoutes);
  await app.register(settingsRoutes);
  await app.register(userRoutes);
  await app.register(storageRoutes);
  await app.register(publicRoutes);

  scheduleRefresh(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`M3U-LIST-GEN listening on http://0.0.0.0:${PORT}`);
  app.log.info(`Data root (persistent): ${DATA_DIR}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Shutting down (${signal})`);
    try {
      await app.close();
    } catch (e) {
      app.log.warn(e);
    }
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function scheduleRefresh(app) {
  // Every minute: per-playlist daily schedule + optional 6/12/24h interval
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      for (const pl of listEnabledPlaylists()) {
        const tz = pl.refresh_timezone || "UTC";
        const wall = wallClockInTz(now, tz);
        let reason = null;

        const time = String(pl.refresh_time || "04:00").slice(0, 5);
        const days = String(pl.refresh_days || "0,1,2,3,4,5,6")
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        const dailyStamp = `${wall.dateKey}-${time}`;
        if (
          wall.clock === time &&
          days.includes(String(wall.weekday)) &&
          pl.refresh_last_daily_stamp !== dailyStamp
        ) {
          reason = `daily ${time} ${tz}`;
          updatePlaylist(pl.id, { refresh_last_daily_stamp: dailyStamp });
        }

        const intervalH = Number(pl.refresh_interval_hours || 0);
        if (!reason && [6, 12, 24].includes(intervalH)) {
          const lastRaw = pl.refresh_last_interval_at || "";
          const lastMs = lastRaw ? Date.parse(lastRaw) : 0;
          const due =
            !lastMs || now.getTime() - lastMs >= intervalH * 60 * 60 * 1000;
          if (due) {
            reason = `every ${intervalH}h`;
            updatePlaylist(pl.id, {
              refresh_last_interval_at: now.toISOString(),
            });
          }
        }

        if (!reason) continue;

        const jobId = createJob(`Refresh · ${pl.name}`);
        appendLog(jobId, `Scheduled (${reason}) for playlist ${pl.slug}`);
        try {
          await generatePlaylist(pl.id, { jobId });
        } catch (e) {
          app.log.error(e, `scheduled refresh failed for ${pl.slug}`);
        }
      }
    } catch (e) {
      app.log.error(e, "scheduled refresh error");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
