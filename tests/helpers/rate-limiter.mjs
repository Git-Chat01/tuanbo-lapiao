// 本地 Durable Object 存储夹具：按对象串行事务，并保留重启前的持久值。
// 不访问 Cloudflare，不绕过生产限流路径。
export function createRateLimiterBinding(LimiterClass) {
  const states = new Map();
  const objects = new Map();
  return {
    states,
    idFromName(name) { return name; },
    get(name) {
      if (!states.has(name)) states.set(name, { values: new Map(), queue: Promise.resolve() });
      const state = states.get(name);
      if (!objects.has(name)) {
        const storage = {
          async get(key) { return structuredClone(state.values.get(key)); },
          async put(key, value) { state.values.set(key, structuredClone(value)); },
          async deleteAll() { state.values.clear(); },
          async setAlarm(time) { state.alarm = time; },
          transaction(callback) {
            const result = state.queue.then(() => callback(storage));
            state.queue = result.catch(() => {});
            return result;
          },
        };
        objects.set(name, new LimiterClass({ storage }));
      }
      return objects.get(name);
    },
    restart() { objects.clear(); },
  };
}
