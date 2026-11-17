// A roster can contain several concurrent members using the same provider.
function attachMemberEngine(job, agent, provider, engine) {
  if (job.run?.sessionTeam) (job.memberEngines ??= new Map()).set(agent, { provider, engine });
  job[provider] = engine;
  return engine;
}

function detachMemberEngine(job, agent, provider, engine) {
  if (job.memberEngines?.get(agent)?.engine === engine) job.memberEngines.delete(agent);
  if (job[provider] === engine) job[provider] = null;
}

function memberEngine(job, agent, provider) {
  return job.run?.sessionTeam ? job.memberEngines?.get(agent)?.engine : job[provider];
}

async function stopMemberEngines(job, close = false) {
  const handles = new Map([...(job.memberEngines?.values() ?? [])].map(({ provider, engine }) => [engine, provider]));
  for (const provider of ['codex', 'claude']) if (job[provider]) handles.set(job[provider], provider);
  await Promise.allSettled([...handles].map(async ([engine, provider]) => {
    if (close) return engine.close();
    try { await (provider === 'codex' ? engine.interrupt() : engine.stop()); }
    catch { engine.close(); }
  }));
}

module.exports = { attachMemberEngine, detachMemberEngine, memberEngine, stopMemberEngines };
