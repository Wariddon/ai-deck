export const permissionModes = ["ask", "auto", "full"];

const writerWorkflows = new Set(["codex", "claude-write", "team", "claude-team", "build-review", "claude-build-review"]);

export function supportsRunPermissions(mode) {
  return writerWorkflows.has(mode);
}

export function codexPermissions(mode, cwd, readOnly, unattended) {
  const full = mode === "full" && !readOnly && !unattended;
  return {
    approvalPolicy: full || unattended ? "never" : "on-request",
    approvalsReviewer: mode === "auto" && !readOnly && !unattended ? "auto_review" : "user",
    sandbox: full ? "danger-full-access" : readOnly ? "read-only" : "workspace-write",
    sandboxPolicy: full ? { type: "dangerFullAccess" } : readOnly ? { type: "readOnly", networkAccess: false }
      : { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
  };
}
