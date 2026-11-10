const { spawn } = require("node:child_process");
const { statSync } = require("node:fs");
const path = require("node:path");

const system = process.env.SystemRoot || "C:\\Windows";
const windowsPowerShell = path.join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const maxInput = 12000;
const maxOutput = 24000;

function firstFile(candidates) {
  return candidates.find((file) => {
    try { return path.isAbsolute(file) && statSync(file).isFile(); } catch { return false; }
  });
}

function previewCommand({ agent, event, handler, cwd, git, pwsh }) {
  const claude = agent === "claude";
  const windows = process.platform === "win32";
  const command = (!claude && windows && (handler.commandWindows ?? handler.command_windows)) || handler.command;
  if (handler.type !== "command" || typeof command !== "string" || !command.trim() || command.length > 8000 || command.includes("\0")) {
    throw new Error("This hook does not have a testable command.");
  }
  const expand = (text) => text.replaceAll("${CLAUDE_PROJECT_DIR}", () => cwd);
  const environment = { ...process.env };
  if (claude) environment.CLAUDE_PROJECT_DIR = cwd;
  const gitRoot = git && path.resolve(path.dirname(git), "..");
  let executable;
  let argv;
  let args;
  if (claude && Array.isArray(handler.args)) {
    if (handler.args.length > 40 || handler.args.some((arg) => typeof arg !== "string" || arg.length > 2000 || arg.includes("\0"))) {
      throw new Error("This hook has invalid executable arguments.");
    }
    executable = expand(command);
    if (/^\.{1,2}[/\\]/u.test(executable)) executable = path.resolve(cwd, executable);
    args = argv = handler.args.map(expand);
  } else {
    const bash = windows ? firstFile([process.env.CLAUDE_CODE_GIT_BASH_PATH, gitRoot && path.join(gitRoot, "bin", "bash.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe")]) : "/bin/bash";
    if (claude && handler.shell === "bash" && !bash) throw new Error("Git Bash is required for this hook.");
    if (claude && handler.shell !== "powershell" && bash) {
      executable = bash;
      argv = ["-c", command];
    } else if (windows || handler.shell === "powershell") {
      executable = pwsh || (windows ? windowsPowerShell : "pwsh");
      const script = claude ? command.replaceAll("${CLAUDE_PROJECT_DIR}", "${env:CLAUDE_PROJECT_DIR}") : command;
      argv = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
    } else {
      executable = "/bin/sh";
      argv = ["-c", command];
    }
  }
  const timeout = Math.min(45, Number.isFinite(handler.timeout) && handler.timeout >= 1 ? handler.timeout : 45);
  const eventName = event.replace(/(?:^|_)([a-z])/gu, (_, first) => first.toUpperCase());
  const sample = { session_id: "ai-deck-hook-test", cwd, hook_event_name: eventName, permission_mode: "default" };
  if (eventName === "SessionStart") sample.source = "startup";
  if (eventName === "UserPromptSubmit") sample.prompt = "AI Deck hook test";
  if (eventName.includes("ToolUse") || eventName === "PermissionRequest" || eventName === "PermissionDenied") {
    sample.tool_name = "Bash";
    sample.tool_input = { command: "echo AI Deck hook test" };
  }
  return { executable, argv, args, command, cwd, timeout, environment, input: JSON.stringify(sample, null, 2) };
}

function parseInput(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > maxInput) throw new Error("Test input must be a JSON object under 12 KB.");
  try {
    const object = JSON.parse(input);
    if (object && typeof object === "object" && !Array.isArray(object)) return JSON.stringify(object) + "\n";
  } catch {}
  throw new Error("Test input must be a valid JSON object.");
}

function runCommand(preview, input, signal) {
  const stdin = input === null ? "" : parseInput(input);
  signal?.throwIfAborted();
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(preview.executable, preview.argv, {
      cwd: preview.cwd, env: preview.environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let reason;
    let killGrace;
    function stop(why) {
      if (reason) return;
      reason = why;
      killGrace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        child.unref();
        finish(child.exitCode, child.signalCode);
      }, 1500);
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      if (process.platform === "win32") {
        const kill = spawn(path.join(system, "System32", "taskkill.exe"), ["/F", "/T", "/PID", String(child.pid)],
          { windowsHide: true, stdio: "ignore" });
        kill.once("error", () => child.kill());
        kill.once("exit", (code) => { if (code && child.exitCode === null) child.kill(); });
      } else child.kill("SIGKILL");
    }
    const cancel = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), preview.timeout * 1000);
    signal?.addEventListener("abort", cancel, { once: true });
    function collect(stream) {
      const chunks = [];
      let bytes = 0;
      let truncated = false;
      stream.on("data", (chunk) => {
        const length = Math.max(0, Math.min(chunk.length, maxOutput - bytes));
        if (length) chunks.push(chunk.subarray(0, length));
        bytes += length;
        truncated ||= length < chunk.length;
      });
      return () => Buffer.concat(chunks).toString("utf8") + (truncated ? "\n[Output truncated]" : "");
    }
    const stdout = collect(child.stdout);
    const stderr = collect(child.stderr);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killGrace);
      signal?.removeEventListener("abort", cancel);
    };
    function finish(code, signal) {
      cleanup();
      resolve({ code, signal, reason, durationMs: Date.now() - start, stdout: stdout(), stderr: stderr() });
    }
    child.once("error", (error) => { cleanup(); reject(new Error("Could not start the hook script (" + (error.code || "spawn error") + ").")); });
    child.once("close", finish);
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

module.exports = { previewCommand, runCommand, windowsPowerShell };
