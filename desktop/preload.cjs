const { contextBridge, ipcRenderer, webUtils } = require("electron");

const commands = [
  "hide-plan-notice",
  "software-updates", "read-software-updates", "open-software-update",
  "save-deck-hooks", "test-deck-hook", "computer-arm", "computer-revoke", "preview-computer-window",
  "native-hooks-sources", "native-hooks-read", "native-hooks-change", "native-hook-test-preview", "native-hook-test-run", "native-hook-test-cancel",
  "save-session-team", "team-provider-models", "save-gemini-key",
  "save-deck-preference", "test-notification", "open-notification", "preview-settings-import", "apply-settings-import", "open-settings-location", "open-provider-terminal",
  "voice-status", "voice-arm", "voice-transcribe", "voice-speak", "voice-cancel",
  "state", "save-appearance", "save-panel-width", "save-low-memory", "system-memory", "save-close-to-tray", "quit-app", "complete-tray-sleep",
  "connections", "choose-cli", "docs", "copy-login", "choose-repo", "startup-data", "pull-native-recents", "native-session-preview", "native-chat-send",
  "save-native-chat-permission", "save-native-chat-models", "native-chat-approve", "native-chat-answer", "native-chat-stop", "native-chat-unshare",
  "native-session-pin", "native-handoff-check", "native-handoff-draft", "native-handoff-recheck", "blocked-plan-target", "blocked-plan-draft",
  "blocked-plan-bases", "blocked-plan-base-draft",
  "native-session-action", "deck-task-action", "delete-selected-sessions", "preview-link", "capture-windows", "preview-window-capture", "attach-window-capture", "cancel-window-capture",
  "linked-source-check", "linked-open", "linked-history", "linked-timeline", "linked-save-next", "linked-prepare",
  "linked-attachments", "linked-copy-command", "linked-open-command", "linked-step-edit",
  "linked-transfer-start", "linked-transfer-files", "linked-transfer-apply", "linked-undo-start", "linked-undo-apply",
  "delivery-check", "copy-delivery-text", "copy-code", "compare-team-runs", "code-graph",
  "import-context", "configure", "changes", "open-worktree", "update-worktree-base", "compare-worktrees", "combine-worktrees", "run", "approve", "stop",
  "switch-repo", "import-project-context",
  "clear-usage-hold", "save-team-assignment", "choose-team-paths", "edit-role-preset", "task-panel", "task-panel-change", "task-panel-item", "team-plan-decision", "preview-continuation", "skill-library-read", "skill-library-edit",
  "switch-task", "new-task", "create-side-chat", "queue-message", "queue-preview", "run-next", "steer-queued", "remove-queued",
  "save-schedule", "toggle-schedule", "remove-schedule", "run-schedule", "cancel-waiting-schedule", "provider-details", "provider-page", "quota-summary",
  "provider-models", "save-agent-settings", "save-run-permissions",
  "codex-reset-usage",
  "codex-task-action", "choose-task-attachments", "add-chat-quote", "paste-clipboard-files", "preview-task-attachment", "discard-draft-attachment",
  "test-provider", "run-scope", "review-files", "save-draft", "answer-question", "continue-run",
  "team-decisions", "save-team-decisions", "resume-team-review", "summarize-team-run",
];
const api = Object.fromEntries(commands.map((name) => [name, (payload) => ipcRenderer.invoke("deck:" + name, payload)]));
api["import-task-files"] = async ({ files, taskId, native, existing }) => {
  const sources = [];
  let clipboardBytes = 0;
  for (const file of files) {
    const filename = webUtils.getPathForFile(file);
    const image = file.type.startsWith("image/");
    if (filename) {
      sources.push({ filename, name: file.name, image });
      continue;
    }
    clipboardBytes += file.size;
    if (clipboardBytes > 32 * 1024 * 1024) throw new Error("Paste smaller batches of files.");
    const document = /\.(?:pdf|docx|xlsx)$/iu.test(file.name);
    if (file.size > (image ? 12 * 1024 * 1024 : document ? 20 * 1024 * 1024 : 256 * 1024)) throw new Error(file.name + " is too large to attach.");
    sources.push({ name: file.name, image, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return ipcRenderer.invoke("deck:add-task-attachments", { sources, taskId, native, existing });
};
api.autosaveDraft = (payload) => ipcRenderer.sendSync("deck:autosave-draft", payload);
api.onEvent = (listener) => {
  const handler = (_event, data) => listener(data);
  ipcRenderer.on("deck:event", handler);
  return () => ipcRenderer.removeListener("deck:event", handler);
};
contextBridge.exposeInMainWorld("aiDeck", api);
