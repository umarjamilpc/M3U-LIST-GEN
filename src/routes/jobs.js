import { currentUser } from "./auth.js";
import {
  getJob,
  listHistory,
  jobLogText,
} from "../services/progress.js";

function publicJob(job, isAdmin) {
  if (!job) return null;
  if (isAdmin) return job;
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    percent: job.percent,
    step: job.step,
    detail: job.detail,
    error: job.error,
    created_at: job.created_at,
    elapsed_label: job.elapsed_label,
    elapsed_seconds: job.elapsed_seconds,
    eta_label: job.eta_label,
    log: [],
  };
}

export default async function jobRoutes(app) {
  app.get("/jobs/:id", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    const job = getJob(req.params.id);
    if (!job) return reply.redirect("/");
    const next = String(req.query.next || "/");
    const safeNext = next.startsWith("/") ? next : "/";
    return reply.view("job.ejs", {
      title: job.title || "Job",
      user,
      job_id: job.id,
      next_url: safeNext,
      show_logs: !!user.is_admin,
    });
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "not found" });
    return publicJob(job, !!user.is_admin);
  });

  app.get("/api/jobs/:id/log.txt", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).type("text/plain").send("Unauthorized\n");
    if (!user.is_admin) {
      return reply.code(403).type("text/plain").send("Admin only\n");
    }
    const text = jobLogText(req.params.id);
    if (text == null) return reply.code(404).type("text/plain").send("Job not found\n");
    reply.header(
      "Content-Disposition",
      `attachment; filename="job-${req.params.id}.log.txt"`
    );
    return reply.type("text/plain; charset=utf-8").send(text);
  });

  app.get("/logs", async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.redirect("/login");
    if (!user.is_admin) return reply.redirect("/");
    const jobs = listHistory();
    const selectedId = String(req.query.job || "");
    const selected = selectedId
      ? getJob(selectedId)
      : jobs[0] || null;
    return reply.view("logs.ejs", {
      title: "Logs",
      user,
      jobs,
      selected,
    });
  });
}
