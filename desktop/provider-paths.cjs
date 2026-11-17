const path = require("node:path");

// Retain a CLI only after a probe has identified the provider. The next portable
// update may omit machine-local defaults, and sign-in is separate from discovery.
function retainProviderPaths(executables, connections) {
  let next = executables;
  for (const agent of ["codex", "claude"]) {
    const checked = connections[agent];
    if (!["ready", "signIn", "upgrade"].includes(checked?.status) ||
        typeof checked.path !== "string" || !path.isAbsolute(checked.path) || executables[agent] === checked.path) continue;
    if (next === executables) next = { ...executables };
    next[agent] = checked.path;
  }
  return next;
}

module.exports = { retainProviderPaths };
