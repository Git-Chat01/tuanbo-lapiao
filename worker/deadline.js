// Optional storage and progress work must never hold a completed judgment hostage.
// Keep mutations of caller-owned state AFTER this boundary: a provider may finish
// late even after cancellation, and its late return must be ignored.
export class DependencyTimeoutError extends Error {
  constructor(reason) {
    super("Optional dependency deadline exceeded");
    this.name = "DependencyTimeoutError";
    this.reason = reason;
  }
}

export async function boundedDependency(operation, work, maxMs, deadline = Infinity) {
  const started = Date.now();
  const budget = Math.min(maxMs, deadline - started);
  const controller = new AbortController();
  let timer;
  try {
    if (!(budget > 0)) throw new DependencyTimeoutError("deadline");
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DependencyTimeoutError("timeout"));
        }, budget);
      }),
    ]);
  } catch (err) {
    try { console.log({event:"coach_dependency_degraded", operation,
      reason:err instanceof DependencyTimeoutError ? err.reason : "unavailable", elapsedMs:Date.now()-started}); } catch {}
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
