// Read-only history refreshes yield to foreground work and never lock the app.
function createRecentLoader({ cache, readers, view = (entry) => entry, blocked = () => false, ttl = 60000, timeout = 24000, now = Date.now }) {
  let flight;
  let updatedAt = 0;
  let errors = {};
  const snapshot = (extra = {}) => ({
    sessions: [...cache.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(view), errors, updatedAt, ...extra,
  });
  return {
    get pending() { return Boolean(flight); },
    cancel() { flight?.controller.abort(); },
    refresh({ force = false } = {}) {
      if (blocked()) return Promise.resolve(snapshot({ deferred: true }));
      if (flight && !flight.controller.signal.aborted) return flight.promise;
      if (!force && updatedAt && now() - updatedAt < ttl) return Promise.resolve(snapshot());
      const controller = new AbortController();
      const current = { controller };
      flight = current;
      current.promise = (async () => {
        const results = await Promise.all(Object.entries(readers).map(async ([provider, read]) => {
          const deadline = new AbortController();
          const timer = setTimeout(() => deadline.abort(new Error("History check timed out.")), timeout);
          const signal = AbortSignal.any([controller.signal, deadline.signal]);
          try { return { provider, entries: await read(signal) }; }
          catch (reason) { return { provider, error: String(reason.message ?? reason).slice(0, 240) }; }
          finally { clearTimeout(timer); }
        }));
        if (controller.signal.aborted || flight !== current) return snapshot({ deferred: true });
        const nextErrors = {};
        for (const { provider, entries, error } of results) {
          if (error) { nextErrors[provider] = error; continue; }
          for (const [key, entry] of cache) if (entry.provider === provider) cache.delete(key);
          for (const entry of entries) cache.set(entry.provider + ":" + entry.id, entry);
        }
        errors = nextErrors;
        updatedAt = now();
        return snapshot();
      })().finally(() => { if (flight === current) flight = undefined; });
      return current.promise;
    },
  };
}

module.exports = { createRecentLoader };
