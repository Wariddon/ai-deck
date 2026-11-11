export function latestReportedRun(runs, provider) {
  return runs.findLast((run) => Object.entries(run.agents ?? {}).some(([id, member]) =>
    (member.provider ?? id) === provider && Number.isFinite(member.usage?.total)));
}
