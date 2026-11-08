const { contextBridge, ipcRenderer } = require("electron");

const commands = [
  "state", "save-appearance", "save-low-memory", "system-memory", "save-close-to-tray", "quit-app", "complete-tray-sleep",
  "connections", "choose-cli", "docs", "copy-login", "choose-repo",
  "import-context", "configure", "changes", "open-worktree", "update-worktree-base", "compare-worktrees", "combine-worktrees", "run", "approve", "stop",
  "switch-repo", "import-project-context",
  "clear-usage-hold", "team-inbox", "save-team-assignment", "edit-role-preset", "task-panel", "task-panel-change", "task-panel-item", "team-plan-decision", "preview-continuation", "skill-library-read", "skill-library-edit",
  "switch-task", "new-task", "queue-message", "queue-preview", "run-next", "steer-queued", "remove-queued",
  "save-schedule", "toggle-schedule", "remove-schedule", "run-schedule", "cancel-waiting-schedule", "provider-details", "provider-page",
  "provider-models", "save-agent-settings",
  "codex-reset-usage",
  "codex-task-action", "choose-text-attachment", "choose-task-images", "paste-task-image", "preview-task-image", "discard-draft-image",
  "test-provider", "run-scope", "review-files", "save-draft", "answer-question", "continue-run",
];
const api = Object.fromEntries(commands.map((name) => [name, (payload) => ipcRenderer.invoke("deck:" + name, payload)]));
api.onEvent = (listener) => {
  const handler = (_event, data) => listener(data);
  ipcRenderer.on("deck:event", handler);
  return () => ipcRenderer.removeListener("deck:event", handler);
};
contextBridge.exposeInMainWorld("aiDeck", api);
