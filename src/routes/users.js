import { currentUser } from "./auth.js";
import {
  listUsers,
  createUser,
  deleteUser,
  getUserById,
} from "../services/auth.js";
import {
  getUserQuotaMb,
  setUserQuotaMb,
  getDefaultQuotaMb,
  getMaxM3uUploadMb,
  userUsageBytes,
} from "../services/quotas.js";
import { formatBytes } from "../services/storage.js";

export default async function userRoutes(app) {
  app.get("/users", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    if (!user.is_admin) return reply.redirect("/");
    const users = listUsers().map((u) => {
      const quotaMb = getUserQuotaMb(u.id);
      const used = userUsageBytes(u);
      return {
        ...u,
        quota_mb: quotaMb,
        usage_bytes: used,
        usage_label: formatBytes(used),
      };
    });
    return reply.view("users.ejs", {
      title: "Users",
      user,
      users,
      default_quota_mb: getDefaultQuotaMb(),
      max_m3u_mb: getMaxM3uUploadMb(),
      formatBytes,
      message: String(req.query.msg || "").replace(/\+/g, " "),
      error: null,
    });
  });

  app.post("/users", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    if (!user.is_admin) return reply.redirect("/");
    try {
      const created = createUser(
        req.body.username,
        req.body.password,
        req.body.is_admin === "1"
      );
      if (req.body.storage_quota_mb !== undefined && req.body.storage_quota_mb !== "") {
        setUserQuotaMb(created.id, req.body.storage_quota_mb);
      }
    } catch (e) {
      const users = listUsers().map((u) => ({
        ...u,
        quota_mb: getUserQuotaMb(u.id),
        usage_bytes: userUsageBytes(u),
        usage_label: formatBytes(userUsageBytes(u)),
      }));
      return reply.view("users.ejs", {
        title: "Users",
        user,
        users,
        default_quota_mb: getDefaultQuotaMb(),
        max_m3u_mb: getMaxM3uUploadMb(),
        formatBytes,
        message: null,
        error: String(e.message || e),
      });
    }
    return reply.redirect("/users?msg=User+added");
  });

  app.post("/users/:id/quota", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    if (!user.is_admin) return reply.redirect("/");
    const id = Number(req.params.id);
    const target = getUserById(id);
    if (!target) return reply.redirect("/users");
    const raw = req.body?.storage_quota_mb;
    if (raw === "" || raw == null) {
      setUserQuotaMb(id, ""); // inherit default
    } else {
      setUserQuotaMb(id, Math.max(0, Number(raw) || 0));
    }
    return reply.redirect("/users?msg=Quota+saved");
  });

  app.post("/users/:id/delete", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    if (!user.is_admin) return reply.redirect("/");
    const id = Number(req.params.id);
    if (id !== user.id) {
      deleteUser(id);
    }
    return reply.redirect("/users?msg=User+deleted");
  });
}
