import { webcrypto as crypto } from "node:crypto";

/** In-memory job progress */

const jobs = new Map();
const history = [];
const MAX_LOG = 2500;
const MAX_HISTORY = 40;

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

function cryptoRandom() {
  return [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function formatDuration(seconds) {
  if (seconds == null || seconds < 0) return "—";
  const sec = Math.round(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function timing(job) {
  const created = job.created_at || Date.now() / 1000;
  const finished = job.finished_at;
  const now = finished || Date.now() / 1000;
  const elapsed = Math.max(0, now - created);
  const pct = Math.max(0, Math.min(100, Number(job.percent) || 0));
  const status = job.status || "running";
  let eta = null;
  if (status === "running" && pct >= 1 && pct < 100) {
    const done = Number(job.items_done) || 0;
    const total = Number(job.items_total) || 0;
    if (total > 0 && done > 0 && done < total) {
      eta = (elapsed / done) * (total - done);
    } else {
      eta = Math.max(0, elapsed / (pct / 100) - elapsed);
    }
  } else if (status === "done" || status === "error") {
    eta = 0;
  }
  return {
    elapsed_seconds: Math.round(elapsed * 10) / 10,
    eta_seconds: eta == null ? null : Math.round(eta * 10) / 10,
    elapsed_label: formatDuration(elapsed),
    eta_label:
      status === "done" ? "done" : eta == null ? "—" : formatDuration(eta),
  };
}

function pushLog(job, message) {
  const msg = String(message || "").trim();
  if (!msg) return;
  const line = `[${stamp()}] ${msg}`;
  const logs = job.log || (job.log = []);
  if (logs.length && (logs[logs.length - 1] === line || logs[logs.length - 1].endsWith(msg))) {
    return;
  }
  logs.push(line);
  if (logs.length > MAX_LOG) job.log = logs.slice(-MAX_LOG);
}

export function createJob(title, steps = []) {
  const id = cryptoRandom();
  jobs.set(id, {
    id,
    title,
    status: "running",
    percent: 0,
    step: steps[0] || "Starting…",
    steps,
    step_index: 0,
    detail: "",
    error: "",
    result: null,
    log: [`[${stamp()}] Started — ${title}`],
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
    finished_at: null,
    items_done: 0,
    items_total: 0,
  });
  return id;
}

export function appendLog(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) return;
  pushLog(job, message);
  job.updated_at = Date.now() / 1000;
}

export function updateJob(jobId, opts = {}) {
  const job = jobs.get(jobId);
  if (!job) return;
  const {
    percent,
    step,
    detail,
    status,
    error,
    result,
    step_index,
    log,
    items_done,
    items_total,
    silent = false,
  } = opts;
  if (percent != null) job.percent = Math.max(0, Math.min(100, Number(percent)));
  if (step != null) job.step = step;
  if (detail != null) job.detail = detail;
  if (status != null) {
    job.status = status;
    if ((status === "done" || status === "error") && !job.finished_at) {
      job.finished_at = Date.now() / 1000;
    }
  }
  if (error != null) job.error = error;
  if (result != null) job.result = result;
  if (items_done != null) job.items_done = Math.max(0, Number(items_done));
  if (items_total != null) job.items_total = Math.max(0, Number(items_total));
  if (step_index != null) {
    job.step_index = step_index;
    if (job.steps?.[step_index]) job.step = job.steps[step_index];
  }
  if (!silent) {
    if (log) pushLog(job, log);
    else {
      const parts = [];
      if (step != null) parts.push(step);
      else if (step_index != null && job.step) parts.push(job.step);
      if (detail != null && String(detail).trim()) parts.push(String(detail).trim());
      if (parts.length) pushLog(job, parts.join(" — "));
    }
  }
  job.updated_at = Date.now() / 1000;
}

export function advance(jobId, stepIndex, percent, detail = "", extra = {}) {
  updateJob(jobId, {
    step_index: stepIndex,
    percent,
    detail,
    ...extra,
  });
}

function archive(job) {
  const snap = { ...job, log: [...(job.log || [])], ...timing(job) };
  history.unshift(snap);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
}

export function finish(jobId, result = null) {
  updateJob(jobId, {
    percent: 100,
    status: "done",
    step: "Done",
    log: "Finished successfully",
    result,
  });
  const job = jobs.get(jobId);
  if (job) archive(job);
}

export function fail(jobId, error) {
  updateJob(jobId, {
    status: "error",
    error: String(error).slice(0, 2000),
    step: "Failed",
    log: `Error: ${String(error).slice(0, 500)}`,
  });
  const job = jobs.get(jobId);
  if (job) archive(job);
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (job) return { ...job, ...timing(job) };
  const h = history.find((j) => j.id === jobId);
  return h ? { ...h, ...timing(h) } : null;
}

export function listHistory(limit = 40) {
  const active = [...jobs.values()]
    .filter((j) => j.status === "running")
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const seen = new Set();
  const out = [];
  for (const j of [...active, ...history]) {
    if (!j.id || seen.has(j.id)) continue;
    seen.add(j.id);
    out.push({ ...j, ...timing(j) });
    if (out.length >= limit) break;
  }
  return out;
}

export function jobLogText(jobId) {
  const job = getJob(jobId);
  if (!job) return null;
  const header = [
    `Job: ${job.title || jobId}`,
    `ID: ${jobId}`,
    `Status: ${job.status}`,
    `Step: ${job.step}`,
    `Elapsed: ${job.elapsed_label}`,
    `ETA: ${job.eta_label}`,
  ];
  if (job.error) header.push(`Error: ${job.error}`);
  header.push("---");
  return header.concat(job.log || []).join("\n") + "\n";
}
