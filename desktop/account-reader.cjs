function createAccountReader(read, { timeout = 12000 } = {}) {
  const jobs = new Map();
  return {
    get pending() { return jobs.size > 0; },
    abort() { for (const { controller } of jobs.values()) controller.abort(new Error("Account check cancelled for another action.")); },
    read(agent) {
      const existing = jobs.get(agent);
      if (existing && !existing.controller.signal.aborted) return existing.promise;
      const controller = new AbortController();
      const job = { controller };
      const timer = setTimeout(() => controller.abort(new Error("Account usage check timed out. Retry or open Account usage.")), timeout);
      jobs.set(agent, job);
      job.promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read(agent, controller.signal);
      }).then((result) => { controller.signal.throwIfAborted(); return result; })
        .catch((error) => { throw controller.signal.aborted ? controller.signal.reason : error; })
        .finally(() => { clearTimeout(timer); if (jobs.get(agent) === job) jobs.delete(agent); });
      return job.promise;
    },
  };
}

function accountQuotaSnapshot(detail) {
  const plan = typeof detail.plan === "string" ? detail.plan.trim().slice(0, 80) : "";
  return { windows: detail.windows ?? [], fetchedAt: detail.fetchedAt, ...(plan && { plan }) };
}

module.exports = { createAccountReader, accountQuotaSnapshot };
