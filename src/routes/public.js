import fs from "node:fs";
import path from "node:path";
import { OUTPUT_DIR } from "../config.js";

function outputFile(username, slug, name) {
  return path.join(OUTPUT_DIR, username.toLowerCase(), slug, name);
}

function safeEpgName(name) {
  const base = path.basename(String(name || ""));
  if (!/^[\w.\-]+$/i.test(base)) return null;
  if (!/\.(xml|gz)$/i.test(base) && !/\.xml\.gz$/i.test(base)) return null;
  return base;
}

export default async function publicRoutes(app) {
  app.get("/u/:username/:slug/playlist.m3u", async (req, reply) => {
    const fp = outputFile(req.params.username, req.params.slug, "playlist.m3u");
    if (!fs.existsSync(fp)) {
      return reply
        .code(503)
        .header("Retry-After", "60")
        .type("text/plain")
        .send(
          "Playlist not generated yet. Open the admin UI and click Regenerate.\n"
        );
    }
    const text = fs.readFileSync(fp, "utf8");
    reply.header("Content-Type", "application/vnd.apple.mpegurl");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${req.params.slug}.m3u"`
    );
    reply.header("Cache-Control", "public, max-age=300");
    return reply.send(text);
  });

  app.get("/u/:username/:slug/epg.xml.gz", async (req, reply) => {
    const fp = outputFile(req.params.username, req.params.slug, "epg.xml.gz");
    if (!fs.existsSync(fp)) {
      return reply
        .code(404)
        .type("text/plain")
        .send(
          "No uploaded EPG on this host. Add an EPG URL or upload a guide in the Guide step.\n"
        );
    }
    reply.header("Content-Type", "application/gzip");
    reply.header("Cache-Control", "public, max-age=300");
    return reply.send(fs.createReadStream(fp));
  });

  app.get("/u/:username/:slug/epg/:file", async (req, reply) => {
    const name = safeEpgName(req.params.file);
    if (!name) return reply.code(400).type("text/plain").send("Invalid file\n");
    const fp = outputFile(req.params.username, req.params.slug, name);
    if (!fs.existsSync(fp)) {
      return reply.code(404).type("text/plain").send("EPG file not found\n");
    }
    const gz = /\.gz$/i.test(name);
    reply.header("Content-Type", gz ? "application/gzip" : "application/xml");
    reply.header("Cache-Control", "public, max-age=300");
    return reply.send(fs.createReadStream(fp));
  });
}
