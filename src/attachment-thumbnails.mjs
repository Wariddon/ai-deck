// Keep thumbnail decoding bounded; never cache full-size attachment previews.
export function createThumbnailLoader(fetch, { concurrency = 2, limit = 32 } = {}) {
  const cached = new Map();
  const requests = new Map();
  const queue = [];
  let active = 0;
  let disposed = false;
  function pump() {
    while (!disposed && active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(() => fetch(job.id)).then((source) => {
        if (disposed) throw new Error("Attachment preview closed.");
        cached.set(job.id, source);
        while (cached.size > limit) cached.delete(cached.keys().next().value);
        job.resolve(source);
      }, job.reject).catch(job.reject).finally(() => { requests.delete(job.id); active--; pump(); });
    }
  }
  return {
    read(id) {
      if (disposed) return Promise.reject(new Error("Attachment preview closed."));
      if (cached.has(id)) {
        const source = cached.get(id);
        cached.delete(id); cached.set(id, source);
        return Promise.resolve(source);
      }
      if (requests.has(id)) return requests.get(id);
      const promise = new Promise((resolve, reject) => queue.push({ id, resolve, reject }));
      requests.set(id, promise);
      pump();
      return promise;
    },
    dispose() {
      disposed = true;
      cached.clear();
      for (const job of queue.splice(0)) { requests.delete(job.id); job.reject(new Error("Attachment preview closed.")); }
    },
  };
}
