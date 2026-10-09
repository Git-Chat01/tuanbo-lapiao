// One durable object per client-generated UUID. Alarms own execution; browser
// requests only create/read a task. Credentials never enter persistent storage.
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const JOB_RUN_MS = 150000;

export function coachJobClass({ generate, authorize, rateLimit, digest }) {
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
      const result = await this.ctx.storage.transaction(async txn => {
        const saved = await txn.get("job");
        if (saved) return {job:saved, conflict:saved.fingerprint !== fingerprint};
        const job = {id:input.id, owner:input.owner, payload:input.payload,
          ipHash:input.ipHash, fingerprint, state:"queued", createdAt:Date.now(),
          expiresAt:Date.now() + JOB_TTL_MS};
        await txn.put("job", job);
        await txn.setAlarm(Date.now());
        return {job};
      });
      if (result.conflict) return Response.json({error:true, message:"任务对应的原稿已经变化，请重新提交当前稿。"}, {status:409});
      if (result.job.expiresAt <= Date.now()) return Response.json({error:true, message:"这次批改记录已过期，请重新提交。"}, {status:410});
      return this.response(result.job);
    }

    async finish(job, result, failure) {
      // Remove the draft and IP fingerprint after execution. A later lookup only
      // needs the immutable result; failed jobs never publish partial grading.
      const finished = {id:job.id, owner:job.owner, fingerprint:job.fingerprint,
        createdAt:job.createdAt, expiresAt:job.expiresAt,
        state:failure ? "failed" : "done", ...(failure ? {failure} : {result})};
      await this.ctx.storage.transaction(async txn => {
        await txn.put("job", finished);
        await txn.setAlarm(finished.expiresAt);
      });
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
        await this.finish(job, null, {status:503, message:"后台批改意外中断，原稿已保留，请重新提交。"});
        return;
      }
      job.state = "running";
      job.phase = "reviewing";
      await this.ctx.storage.transaction(async txn => {
        await txn.put("job", job);
        await txn.setAlarm(Date.now() + JOB_RUN_MS);
      });
      let result, failure, timer, expired = false;
      const started = Date.now();
      try {
        result = await Promise.race([(async () => {
          // Rotation/revocation takes effect before a queued job can spend tokens.
          if (!await authorize(this.env, job.owner)) {
            const err = new Error("入口码已变更，请重新输入后提交。"); err.status = 401; throw err;
          }
          const denied = await rateLimit(this.env, job.ipHash);
          if (denied) { const err = new Error(denied.message); err.status = denied.status; throw err; }
          if (expired) throw new Error("Job deadline elapsed before generation");
          return generate({...job.payload, accessCode:this.env.ACCESS_CODE}, this.env, this.ctx, started + JOB_RUN_MS, async phase => {
            if (expired || !["reviewing","recovering","checking_advice"].includes(phase)) return;
            await this.ctx.storage.transaction(async txn => {
              const current = await txn.get("job");
              if (current?.state === "running" && current.id === job.id) {
                current.phase = phase;
                await txn.put("job",current);
              }
            });
          });
        })(), new Promise((_, reject) => {
          timer = setTimeout(() => { expired = true; const err = new Error("这次批改超过后台等待时限，原稿已保留，请重试。"); err.status = 504; reject(err); }, JOB_RUN_MS);
        })]);
      } catch (err) {
        failure = {status:err.status || 500,
          message:err.publicMessage || (err.status ? err.message : "批改暂时未完成，原稿已保留，请重试。")};
      } finally { clearTimeout(timer); }
      await this.finish(job, result, failure);
      console.log(JSON.stringify({event:"coach_job", state:failure ? "failed" : "done",
        queueMs:started-job.createdAt, executionMs:Date.now()-started, status:failure?.status || 200}));
    }
  };
}
