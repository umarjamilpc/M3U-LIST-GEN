import { currentUser } from "./auth.js";
import {
  formatBytes,
  getUserStorage,
  getAdminStorage,
  deleteUserGenerated,
  deleteUserUploads,
  deleteAllGenerated,
  clearCache,
  deleteOneStoredFile,
} from "../services/storage.js";
import { getUserByUsername, listUsers } from "../services/auth.js";
import {
  getUserQuotaMb,
  getDefaultQuotaMb,
  mbToBytes,
} from "../services/quotas.js";

export default async function storageRoutes(app) {
  app.get("/storage", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const data = user.is_admin ? getAdminStorage() : getUserStorage(user);

    let quota = null;
    if (user.is_admin) {
      const byUser = (data.by_user || []).map((u) => {
        const quotaMb = getUserQuotaMb(u.id);
        return {
          ...u,
          quota_mb: quotaMb,
          quota_bytes: quotaMb > 0 ? mbToBytes(quotaMb) : 0,
        };
      });
      data.by_user = byUser;
    } else {
      const quotaMb = getUserQuotaMb(user.id);
      const used = data.totals.all || 0;
      quota = {
        mb: quotaMb,
        bytes: quotaMb > 0 ? mbToBytes(quotaMb) : 0,
        used,
        unlimited: quotaMb <= 0,
      };
    }

    return reply.view("storage.ejs", {
      title: "Storage",
      user,
      formatBytes,
      scope: data.scope,
      totals: data.totals,
      sections: data.sections,
      by_user: data.by_user,
      focus_user: String(req.query.user || ""),
      message: String(req.query.msg || "").replace(/\+/g, " "),
      error: String(req.query.err || "").replace(/\+/g, " "),
      quota,
      default_quota_mb: getDefaultQuotaMb(),
    });
  });

  app.post("/storage/delete", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");

    const group = String(req.body?.group || "");
    const targetUser = String(req.body?.username || "").trim().toLowerCase();
    const rel = String(req.body?.rel || "").trim();
    const filePath = String(req.body?.path || "").trim();

    // Per-file delete (own files for users; any for admin)
    if (group === "file") {
      const kind = String(req.body?.kind || "");
      const ok = deleteOneStoredFile(user, { kind, rel, filePath });
      if (!ok) {
        return reply.redirect("/storage?err=Could+not+delete+file");
      }
      const q = targetUser ? `&user=${encodeURIComponent(targetUser)}` : "";
      return reply.redirect(`/storage?msg=File+deleted${q}`);
    }

    // Non-admins may only clear their own generated files / uploads
    if (!user.is_admin) {
      if (group === "user_generated" || group === "generated_m3u") {
        deleteUserGenerated(user.username);
        return reply.redirect("/storage?msg=Generated+files+cleared");
      }
      if (group === "uploads" || group === "user_uploads") {
        deleteUserUploads(user.id);
        return reply.redirect("/storage?msg=Uploads+cleared");
      }
      return reply.redirect("/storage");
    }

    if (group === "cache") {
      clearCache();
    } else if (group === "generated_m3u") {
      if (targetUser) deleteUserGenerated(targetUser);
      else deleteAllGenerated();
    } else if (group === "user_generated" && targetUser) {
      deleteUserGenerated(targetUser);
    } else if (group === "uploads") {
      if (targetUser) {
        const u = getUserByUsername(targetUser);
        if (u) deleteUserUploads(u.id);
      } else {
        for (const u of listUsers()) deleteUserUploads(u.id);
      }
    } else if (group === "user_uploads" && targetUser) {
      const u = getUserByUsername(targetUser);
      if (u) deleteUserUploads(u.id);
    }

    const q = targetUser ? `?user=${encodeURIComponent(targetUser)}` : "";
    return reply.redirect(`/storage${q}`);
  });
}
