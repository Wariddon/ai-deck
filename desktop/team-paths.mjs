export function validScope(file) {
  if (typeof file !== "string" || !file || file.length > 1024 || /[\u0000-\u001f*?\\:"<>|]/u.test(file)) return false;
  return file.replace(/\/$/u, "").split("/").every((part) => part && !/[. ]$/u.test(part) && part.toLowerCase() !== ".git");
}

export function scopeIncludes(scope, file) {
  const key = scope.toLowerCase();
  const target = file.toLowerCase();
  return key.endsWith("/") ? target.startsWith(key) : key === target;
}

export function overlappingScope(first, second) {
  const stem = (file) => file.toLowerCase().replace(/\/$/u, "");
  const targets = second.map(stem);
  return first.find((file) => {
    const key = stem(file);
    return targets.some((target) => key === target || key.startsWith(target + "/") || target.startsWith(key + "/"));
  });
}

export function separateWriteScopes(teamwork) {
  const paths = {};
  for (const [agent, name] of [["codex", "Codex"], ["claude", "Claude Code"]]) {
    const entries = (teamwork?.[agent + "Paths"] ?? "").split(/\r?\n/u).map((file) => file.trim()).filter(Boolean);
    if (!entries.length || entries.length > 24 || !entries.every(validScope)) {
      throw new Error(name + " needs 1–24 repository-relative paths. Use one path per line and a trailing slash for a folder.");
    }
    paths[agent] = [...new Set(entries)];
  }
  const overlap = overlappingScope(paths.codex, paths.claude);
  if (overlap) throw new Error("Both writers claim " + overlap + ". Give it to one writer in Team Brief.");
  return paths;
}

export function laneScopeResult(scope, before, after, changedPaths) {
  if (!before?.stamp || !after?.stamp || !before.staged || !after.staged || !changedPaths) {
    return { issue: "AI Deck could not verify this worktree after the run." };
  }
  if (before.head !== after.head || before.branch !== after.branch || before.staged !== after.staged) {
    return { issue: "Git HEAD, branch or staging changed during this lane." };
  }
  const outside = changedPaths.filter((file) => !scope.some((entry) => scopeIncludes(entry, file)));
  return { changed: changedPaths.slice(0, 24), ...(outside.length && {
    outside: outside.slice(0, 24), issue: "This lane changed paths outside its assignment.",
  }) };
}
