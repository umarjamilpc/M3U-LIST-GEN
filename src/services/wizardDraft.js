/**
 * Session-only playlist draft for Name → Source → Guide.
 * A DB row is created only when entering Channels (still setup_complete=0
 * until Generate finishes).
 */

export function getPlaylistDraft(session) {
  const d = session?.playlistDraft;
  if (!d || typeof d !== "object") return null;
  return d;
}

export function draftAsPlaylist(draft) {
  const d = draft || {};
  return {
    id: null,
    name: d.name || "",
    slug: d.slug || "",
    source_modes: d.source_modes || "iptvorg",
    countries: d.countries || "",
    source_m3u_url: d.source_m3u_url || "",
    epg_url: d.epg_url || "",
    epg_category: d.epg_category || "US",
    m3u_include_epg: d.m3u_include_epg == null ? 1 : d.m3u_include_epg ? 1 : 0,
    enabled: 1,
    setup_complete: 0,
  };
}

function sessionIdentity(session) {
  return {
    userId: session.userId,
    username: session.username,
    isAdmin: session.isAdmin,
  };
}

export function savePlaylistDraft(reply, req, patch) {
  const prev = getPlaylistDraft(req.session) || {};
  reply.setSession({
    ...sessionIdentity(req.session),
    playlistDraft: { ...prev, ...patch },
  });
}

export function clearPlaylistDraft(reply, req) {
  reply.setSession(sessionIdentity(req.session));
}
