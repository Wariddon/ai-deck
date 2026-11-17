// Settings replies can arrive after live job events. Apply only the saved owner/provider.
export function applySavedModelSettings(current, next, { agent, scope, repo, taskId }) {
  const field = scope === 'default' ? 'agentSettings' : scope === 'project' ? 'models' : scope === 'task' ? 'agentModels' : null;
  if (!field || !['codex', 'claude'].includes(agent)) return current;
  const global = scope === 'default', target = global ? current : current.workspace, source = global ? next : next?.workspace;
  if (!target || !source || !global && (target.repo !== repo || source.repo !== repo ||
      scope === 'task' && (target.taskId !== taskId || source.taskId !== taskId))) return current;
  const settings = { ...target[field] };
  if (source[field]?.[agent]) settings[agent] = source[field][agent];
  else delete settings[agent];
  return global ? { ...current, [field]: settings } : { ...current, workspace: { ...target, [field]: settings } };
}
