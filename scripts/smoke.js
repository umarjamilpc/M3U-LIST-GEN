const base = "http://127.0.0.1:3000";

function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (list.length) return list.map((c) => c.split(";")[0]).join("; ");
  const raw = res.headers.get("set-cookie") || "";
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookie(prev, res) {
  const next = cookieFrom(res);
  if (!next) return prev;
  const map = new Map();
  for (const part of `${prev}; ${next}`.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    map.set(part.slice(0, i), part);
  }
  return [...map.values()].join("; ");
}

async function main() {
  const loginPage = await fetch(`${base}/login`);
  console.log("GET /login", loginPage.status);

  let cookie = "";
  const login = await fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "username=admin&password=admin",
  });
  console.log("POST /login", login.status, login.headers.get("location"));
  cookie = mergeCookie(cookie, login);
  console.log("cookie ok", Boolean(cookie));

  const dash = await fetch(`${base}/`, { headers: { Cookie: cookie }, redirect: "manual" });
  console.log("GET /", dash.status, (await dash.text()).includes("Playlists"));

  // Name → session draft (no playlist id yet)
  let r = await fetch(`${base}/playlists/new`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "name=Smoke+Test&slug=smoke-test",
  });
  cookie = mergeCookie(cookie, r);
  let loc = r.headers.get("location") || "";
  console.log("POST new (draft)", r.status, loc);
  if (!loc.includes("/playlists/new/wizard/source")) {
    throw new Error("expected draft source redirect, got " + loc);
  }

  r = await fetch(`${base}/playlists/new/wizard/source`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "wizard_action=next&source_mode=iptvorg&countries=US&source_m3u_url=",
  });
  cookie = mergeCookie(cookie, r);
  console.log("source", r.status, r.headers.get("location"));

  r = await fetch(`${base}/playlists/new/wizard/guide`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "wizard_action=next&epg_category=US&m3u_include_epg=1&epg_url=" +
      encodeURIComponent(
        "https://raw.githubusercontent.com/umarjamilpc/EPG-LIST-GEN/main/epgs/US/merge/merged-epg.xml.gz"
      ),
  });
  cookie = mergeCookie(cookie, r);
  loc = r.headers.get("location") || "";
  console.log("guide→channels (create)", r.status, loc);
  const id = (loc.match(/playlists\/(\d+)/) || [])[1];
  if (!id) throw new Error("no playlist id after guide — playlist should be created entering Channels");

  // Still incomplete — should not appear on dashboard yet
  const dashMid = await fetch(`${base}/`, { headers: { Cookie: cookie } });
  const midHtml = await dashMid.text();
  if (midHtml.includes("smoke-test") || midHtml.includes("Smoke Test")) {
    throw new Error("incomplete playlist should not appear on dashboard");
  }
  console.log("dashboard hides incomplete", true);

  r = await fetch(`${base}/playlists/${id}/channels?wizard=1`, {
    headers: { Cookie: cookie },
  });
  const chHtml = await r.text();
  console.log("channels", r.status, chHtml.includes("Your list") || chHtml.includes("Channels"));

  r = await fetch(`${base}/playlists/${id}/wizard/generate`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "wizard_action=generate",
  });
  cookie = mergeCookie(cookie, r);
  const jobLoc = r.headers.get("location") || "";
  console.log("generate", r.status, jobLoc);
  const jobId = (jobLoc.match(/jobs\/([^?]+)/) || [])[1];
  if (!jobId) throw new Error("no job id");

  for (let i = 0; i < 90; i++) {
    await new Promise((x) => setTimeout(x, 1000));
    const j = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    console.log(`job ${j.status} ${j.percent}% ${j.step || ""}`);
    if (j.status === "done" || j.status === "error") {
      console.log(JSON.stringify({ status: j.status, error: j.error, result: j.result }, null, 2));
      break;
    }
  }

  const dashDone = await fetch(`${base}/`, { headers: { Cookie: cookie } });
  const doneHtml = await dashDone.text();
  console.log("dashboard shows complete", doneHtml.includes("smoke-test") || doneHtml.includes("Smoke Test"));

  const m3u = await fetch(`${base}/u/admin/smoke-test/playlist.m3u`);
  const text = await m3u.text();
  console.log("public m3u", m3u.status, text.slice(0, 240).replace(/\n/g, "\\n"));

  const settings = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  console.log("settings", settings.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
