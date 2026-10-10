// One durable object per client-generated UUID. Alarms own execution; browser
// requests only create/read a task. Credentials never enter persistent storage.
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const JOB_RUN_MS = 150000;

const LOG_PHASES = new Set(["queued", "authorizing", "rate_limit", "reviewing", "recovering", "checking_advice", "saving_result"]);
const LOG_REASONS = new Set(["accepted", "execution_started", "completed", "access_revoked", "rate_limited", "admission_failed", "generation_timeout", "generation_failed", "interrupted", "result_storage_failed", "start_storage_failed", "admission_storage_failed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deliberately select every logged field: never serialize a job, report or error.
// Logs are best-effort operational evidence, not a billing/accounting ledger.
function logJob(job, lifecycle, {phase, reason, status}, serviceVersion) {
  const now = Date.now();
  const created = Number.isFinite(job.createdAt) ? job.createdAt : null;
  const started = Number.isFinite(job.startedAt) ? job.startedAt : null;
  const pending = lifecycle === "admitted";
  const duration = (end, start) => start === null ? null : Math.max(0, end - start);
  try {
    console.log({event:"coach_job", schemaVersion:1, lifecycle,
      serviceVersion:typeof serviceVersion === "string" && /^[a-z0-9._-]{1,80}$/i.test(serviceVersion) ? serviceVersion : null,
      jobId:typeof job.id === "string" && UUID.test(job.id) ? job.id : null,
      state:["queued", "running", "done", "failed"].includes(job.state) ? job.state : "queued",
      phase:LOG_PHASES.has(phase) ? phase : "reviewing",
      reason:LOG_REASONS.has(reason) ? reason : "generation_failed",
      status:Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500,
      queueMs:pending ? 0 : started === null ? null : duration(started, created),
      executionMs:pending ? 0 : duration(now, started), totalMs:duration(now, created)});
  } catch { /* Diagnostic collection must never reject an otherwise valid result. */ }
}

export function coachJobClass({ generate, authorize, rateLimit, digest, serviceVersion }) {
  return class CoachJob {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }

    response(job) {
      return Response.json({
        ok: true, jobId: job.id, state: job.state, expiresAt: job.expiresAt,
        ...(job.state === "running" ? {phase:job.phase || "reviewing"} : {}),
        ...(job.state === "done" ? {report: job.result.report} : {}),
        ...(job.state === "failed" ? {failure: job.failure} : {}),
      }, {status: job.state === "queued" || job.state === "running" ? 202 : 200});
    }

    async fetch(request) {
      if (request.method === "GET") {
        const job = await this.ctx.storage.get("job");
        return job && job.expiresAt > Date.now() ? this.response(job)
          : Response.json({error:true, message:"这次批改记录已过期或不存在，原稿仍在，请重新提交。"}, {status:404});
      }
      if (request.method !== "PUT") return new Response(null, {status:405});
      const input = await request.json();
      const fingerprint = await digest(input.payload);
      // Atomic admission + alarm: lost create responses can safely be retried.
      let result;
      try { result = await this.ctx.storage.transaction(async txn => {
        const saved = await txn.get("job");
        if (saved) return {job:saved, conflict:saved.fingerprint !== fingerprint};
        const job = {id:input.id, owner:input.owner, payload:input.payload,
          ipHash:input.ipHash, fingerprint, state:"queued", createdAt:Date.now(),
          expiresAt:Date.now() + JOB_TTL_MS};
        await txn.put("job", job);
        await txn.setAlarm(Date.now());
        return {job, admitted:true};
      }); } catch (err) {
        logJob({id:input.id, state:"queued"}, "persistence_failed", {phase:"queued", reason:"admission_storage_failed", status:503}, serviceVersion);
        throw err;
      }
      // Outside the transaction: retries of its callback or of PUT cannot count
      // the same admission twice. No logging work adds a storage dependency.
      if (result.admitted) logJob(result.job, "admitted", {phase:"queued", reason:"accepted", status:202}, serviceVersion);
      if (result.conflict) return Response.json({error:true, message:"任务对应的原稿已经变化，请重新提交当前稿。"}, {status:409});
      if (result.job.expiresAt <= Date.now()) return Response.json({error:true, message:"这次批改记录已过期，请重新提交。"}, {status:410});
      return this.response(result.job);
    }

    async finish(job, result, failure, {reason, phase} = {}) {
      // Remove the draft and IP fingerprint after execution. A later lookup only
      // needs the immutable result; failed jobs never publish partial grading.
      const finished = {id:job.id, owner:job.owner, fingerprint:job.fingerprint,
        createdAt:job.createdAt, startedAt:job.startedAt, expiresAt:job.expiresAt,
        state:failure ? "failed" : "done", ...(failure ? {failure} : {result})};
      try {
        await this.ctx.storage.transaction(async txn => {
          await txn.put("job", finished);
          await txn.setAlarm(finished.expiresAt);
        });
      } catch (err) {
        logJob(job, "persistence_failed", {phase:"saving_result", reason:"result_storage_failed", status:503}, serviceVersion);
        throw err;
      }
      // Only a committed, retrievable result counts as a terminal outcome.
      logJob(finished, "terminal", {phase:phase || job.phase, reason:reason || (failure ? "generation_failed" : "completed"), status:failure?.status || 200}, serviceVersion);
    }

    async alarm() {
      const job = await this.ctx.storage.get("job");
      if (!job) return;
      if (job.expiresAt <= Date.now()) { await this.ctx.storage.deleteAll(); return; }
      if (job.state === "done" || job.state === "failed") {
        await this.ctx.storage.setAlarm(job.expiresAt); return;
      }
      // Alarm delivery is at-least-once. After a host crash the provider outcome
      // is unknown; do NOT blindly start a second paid generation.
      if (job.state === "running") {
        await this.finish(job, null, {status:503, message:"后台批改意外中断，原稿已保留，请重新提交。"}, {reason:"interrupted", phase:job.phase});
        return;
      }
      job.state = "running";
      job.phase = "reviewing";
      job.startedAt = Date.now();
      try {
        await this.ctx.storage.transaction(async txn => {
          await txn.put("job", job);
          await txn.setAlarm(job.startedAt + JOB_RUN_MS);
        });
      } catch (err) {
        logJob({...job, state:"queued"}, "persistence_failed", {phase:"queued", reason:"start_storage_failed", status:503}, serviceVersion);
        throw err;
      }
      logJob(job, "started", {phase:"authorizing", reason:"execution_started", status:202}, serviceVersion);
      let result, failure, timer, expired = false, phase = "authorizing", reason;
      const started = job.startedAt;
      try {
        result = await Promise.race([(async () => {
          // Rotation/revocation takes effect before a queued job can spend tokens.
          if (!await authorize(this.env, job.owner)) {
            const err = new Error("入口码已变更，请重新输入后提交。"); err.status = 401; throw err;
          }
          phase = "rate_limit";
          const denied = await rateLimit(this.env, job.ipHash);
          if (denied) { reason = denied.status === 429 ? "rate_limited" : "admission_failed"; const err = new Error(denied.message); err.status = denied.status; throw err; }
          if (expired) throw new Error("Job deadline elapsed before generation");
          phase = "reviewing";
          return generate({...job.payload, accessCode:this.env.ACCESS_CODE}, this.env, this.ctx, started + JOB_RUN_MS, async nextPhase => {
            if (expired || !["reviewing","recovering","checking_advice"].includes(nextPhase)) return;
            await this.ctx.storage.transaction(async txn => {
              const current = await txn.get("job");
              if (current?.state === "running" && current.id === job.id) {
                current.phase = nextPhase;
                await txn.put("job",current);
              }
            });
            phase = nextPhase;
            job.phase = nextPhase;
          });
        })(), new Promise((_, reject) => {
          timer = setTimeout(() => { expired = true; const err = new Error("这次批改超过后台等待时限，原稿已保留，请重试。"); err.status = 504; reject(err); }, JOB_RUN_MS);
        })]);
      } catch (err) {
        reason ||= expired || err.status === 504 ? "generation_timeout" : phase === "authorizing" && err.status === 401 ? "access_revoked" : ["authorizing", "rate_limit"].includes(phase) ? "admission_failed" : "generation_failed";
        failure = {status:err.status || 500,
          message:err.publicMessage || (err.status ? err.message : "批改暂时未完成，原稿已保留，请重试。")};
      } finally { clearTimeout(timer); }
      await this.finish(job, result, failure, {reason, phase});
    }
  };
}
