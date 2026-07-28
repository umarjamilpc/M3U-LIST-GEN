import { currentUser } from "./auth.js";
import {
  listPlaylists,
  publicUrls,
  resolvePublicBase,
} from "../services/playlists.js";
import { getUserById } from "../services/auth.js";

export default async function dashboardRoutes(app) {
  app.get("/", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const base = resolvePublicBase(req);
    const playlists = listPlaylists(user.id, user.is_admin).map((pl) => {
      const owner = getUserById(pl.user_id);
      const urls = publicUrls(owner?.username || user.username, pl.slug, base);
      return { ...pl, urls };
    });
    return reply.view("dashboard.ejs", {
      title: "Playlists",
      user,
      playlists,
    });
  });
}
