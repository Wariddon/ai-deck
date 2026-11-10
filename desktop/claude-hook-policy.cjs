const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { previewCommand } = require("./native-hook-test.cjs");

const permissionEvents = new Set(["PreToolUse", "PermissionRequest", "PermissionDenied"]);

function protectClaudeHook(event, handler, runtime) {
  if (!permissionEvents.has(event)) return handler;
  const { shell, args, command, ...options } = handler;
  const index = runtime.specs.push({ event, handler: { type: "command", shell, args, command }, git: runtime.git, pwsh: runtime.pwsh }) - 1;
  return { ...options, command: process.execPath, args: [runtime.worker, runtime.specFile, String(index)] };
}

function safeHookOutput(event, output) {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) return "";
  let value;
  try { value = JSON.parse(trimmed); } catch { return ""; }
  const { systemMessage, continue: proceed, stopReason, suppressOutput, reason } = value;
  const safe = { systemMessage, continue: proceed, stopReason, suppressOutput, reason };
  if (value.decision === "block") safe.decision = "block";
  const fields = value.hookSpecificOutput;
  if (fields?.hookEventName === event) {
    const result = { hookEventName: event };
    if (event === "PreToolUse") {
      if (fields.permissionDecision === "deny" || fields.permissionDecision === "ask") {
        result.permissionDecision = fields.permissionDecision;
        result.permissionDecisionReason = fields.permissionDecisionReason;
      }
      result.additionalContext = fields.additionalContext;
    }
    if (event === "PermissionRequest" && fields.decision?.behavior === "deny") {
      result.decision = { behavior: "deny", message: fields.decision.message, interrupt: fields.decision.interrupt };
    }
    safe.hookSpecificOutput = result;
  }
  return JSON.stringify(safe);
}

function run() {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8"))[Number(process.argv[3])];
  if (!permissionEvents.has(spec.event)) throw new Error("Invalid hook policy event.");
  const command = previewCommand({ ...spec, agent: "claude", cwd: process.cwd() });
  delete command.environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(command.executable, command.argv, { env: command.environment, windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
  child.stdin.on("error", () => {});
  process.stdin.pipe(child.stdin);
  const maxBytes = 128 * 1024;
  let length = 0;
  const output = [];
  child.stdout.on("data", (chunk) => {
    length += chunk.length;
    if (length <= maxBytes) output.push(chunk);
  });
  child.once("error", (error) => { process.stderr.write("AI Deck hook: " + error.code + "\n"); process.exitCode = 1; });
  child.once("close", (code) => {
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    if (length > maxBytes) process.stderr.write("AI Deck hook output exceeded 128 KB.\n");
    else if (output.length) process.stdout.write(safeHookOutput(spec.event, Buffer.concat(output).toString("utf8")));
    process.exitCode = code ?? 1;
  });
}

if (require.main === module) run();
module.exports = { protectClaudeHook, safeHookOutput };
