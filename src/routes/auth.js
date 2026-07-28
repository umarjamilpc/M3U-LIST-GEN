import { authenticate, ensureAdmin } from "../services/auth.js";
import { ADMIN_USERNAME, ADMIN_PASSWORD } from "../config.js";
import { getUserById } from "../services/auth.js";

export default async function authRoutes(app) {
  ensureAdmin(ADMIN_USERNAME, ADMIN_PASSWORD);

  app.get("/login", async (req, reply) => {
    if (req.session?.userId) return reply.redirect("/");
    return reply.view("login.ejs", { title: "Login", error: null, user: null });
  });

  app.post("/login", async (req, reply) => {
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");
    const user = authenticate(username, password);
    if (!user) {
      return reply.view("login.ejs", {
        title: "Login",
        error: "Invalid username or password",
        user: null,
      });
    }
    reply.setSession({
      userId: user.id,
      username: user.username,
      isAdmin: Boolean(user.is_admin),
    });
    return reply.redirect("/");
  });

  app.get("/logout", async (req, reply) => {
    reply.clearSession();
    return reply.redirect("/login");
  });
}

export function currentUser(req) {
  if (!req.session?.userId) return null;
  const u = getUserById(req.session.userId);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    is_admin: Boolean(u.is_admin),
  };
}
