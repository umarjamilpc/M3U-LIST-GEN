import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("E:/CURSOR/iptv-filter/data/iptv.db");
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1")
  .all()
  .map((t) => t.name);
console.log("tables:", tables.join(", "));
for (const [label, sql] of [
  ["users", "SELECT COUNT(*) AS c FROM users"],
  ["playlists", "SELECT COUNT(*) AS c FROM playlists"],
  ["channels", "SELECT COUNT(*) AS c FROM playlist_channels"],
  ["settings", "SELECT COUNT(*) AS c FROM settings"],
  ["stash", "SELECT COUNT(*) AS c FROM playlist_channel_stash"],
]) {
  try {
    console.log(label + ":", db.prepare(sql).get().c);
  } catch (e) {
    console.log(label + ": missing");
  }
}
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
console.log("checkpointed ok");
