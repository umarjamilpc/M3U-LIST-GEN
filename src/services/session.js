import crypto from "node:crypto";
import { SECRET_KEY, SESSION_MAX_AGE } from "../config.js";

const COOKIE = "m3u_session";

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function unsign(token) {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expect = crypto
      .createHmac("sha256", SECRET_KEY)
      .update(body)
      .digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionPlugin(fastify) {
  fastify.decorateRequest("session", null);

  fastify.addHook("onRequest", async (req, reply) => {
    const raw = req.cookies?.[COOKIE];
    const data = raw ? unsign(raw) : null;
    req.session = data || {};
  });

  fastify.decorateReply("setSession", function setSession(data) {
    const payload = {
      ...data,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    };
    this.setCookie(COOKIE, sign(payload), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
    });
  });

  fastify.decorateReply("clearSession", function clearSession() {
    this.clearCookie(COOKIE, { path: "/" });
  });
}

export function requireUser(req, reply) {
  if (!req.session?.userId) {
    reply.redirect("/login");
    return null;
  }
  return { id: req.session.userId, username: req.session.username, is_admin: req.session.isAdmin };
}
