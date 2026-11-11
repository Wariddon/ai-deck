const contextPrefixes = [
  "The earlier plan needs verification on this checkout. Verify paths and claims against the current files.\n\n",
  "The earlier plan was blocked in another project. Verify paths and claims against the new checkout.\n\n",
];
const repoKey = (repo) => String(repo ?? "").replaceAll("\\", "/").replace(/\/$/u, "").toLowerCase();
const originKey = (task) => {
  const origin = task.nativeHandoff?.source;
  return origin?.provider && origin.id ? origin.provider + ":" + origin.id : null;
};
const imageKey = (images = []) => {
  if (!Array.isArray(images) || images.some((image) => typeof image?.id !== "string" || !image.id)) return null;
  return JSON.stringify(images.map(({ id }) => id).sort());
};

export function replanContext(plan) {
  return contextPrefixes[0] + (typeof plan?.text === "string" ? plan.text.slice(0, 5000) : "");
}

// Legacy releases saved a quoted plan rather than source IDs. Require exact,
// independent matches before presenting those chats as related continuations.
export function replanLinks(workspaces, sourceRepo, source) {
  if (!source || !workspaces || typeof workspaces !== "object") return [];
  const plans = (Array.isArray(source.runHistory) ? source.runHistory : [])
    .filter((run) => run?.finishedAt && typeof run.teamPlan?.text === "string" && run.teamPlan.text.length >= 64);
  const origin = originKey(source);
  const links = [];
  for (const workspace of Object.values(workspaces)) for (const task of Array.isArray(workspace?.tasks) ? workspace.tasks : []) {
    if (!task || task.id === source.id || task.archivedAt) continue;
    let runId;
    if (task.replanSource) {
      if (task.replanSource.taskId !== source.id || repoKey(task.replanSource.repo) !== repoKey(sourceRepo)) continue;
      runId = task.replanSource.runId;
    } else {
      if (!origin || originKey(task) !== origin || task.forkedFrom !== source.title || !task.forkContext) continue;
      const seed = task.runHistory?.[0] ?? task.savedDraft;
      const images = imageKey(seed?.images);
      const matches = plans.filter((run) => contextPrefixes.some((prefix) =>
        task.forkContext === prefix + run.teamPlan.text.slice(0, 5000)) && images !== null && imageKey(run.images) === images);
      if (matches.length !== 1) continue;
      runId = matches[0].id;
    }
    if (!runId) continue;
    links.push({ repo: workspace.repo, taskId: task.id, title: task.title, sourceRunId: runId });
  }
  return links;
}
