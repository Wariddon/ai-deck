const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const { randomUUID } = require("node:crypto");
const { version } = require("./package.json");
const { codexLimit, claudeLimitEvent, claudeQuota, textLimit } = require("./usage-limit.cjs");
const { readQuestions, validateAnswers } = require("./questions.cjs");

function codexInput(text, images = []) {
  return [{ type: "text", text }, ...images.map(({ filename }) => ({ type: "localImage", path: filename }))];
}

function claudeInput(text, images = []) {
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map(({ filename }) => ({ type: "image", source: {
      type: "base64", media_type: filename.endsWith(".png") ? "image/png" : "image/jpeg", data: readFileSync(filename, "base64"),
    } })),
  ];
}

function capture(exe, args, { cwd, timeout = 12000, limit = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.exitCode != null || child.signalCode != null) reject(new Error("Command timed out."));
      else child.kill();
    }, timeout);
    child.stdout.setEncoding("utf8").on("data", (part) => { stdout = (stdout + part).slice(0, limit); });
    child.stderr.setEncoding("utf8").on("data", (part) => { stderr = (stderr + part).slice(0, 5000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { if (timedOut) reject(new Error("Command timed out.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("Command timed out."));
      else resolve({ code, stdout, stderr });
    });
  });
}

function lineReader(child, receive) {
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    try {
      const data = JSON.parse(line);
      if (data && typeof data === "object") receive(data);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  });
  return lines;
}

function pluginArguments(plugins) {
  return plugins.flatMap(({ name, url, tools, enabled, scope }) => {
    if (enabled === false || scope === "claude") return ["-c", `mcp_servers.${name}.enabled=false`];
    return [
      "-c", `mcp_servers.${name}.enabled=true`,
      "-c", `mcp_servers.${name}.url=${JSON.stringify(url)}`,
      "-c", `mcp_servers.${name}.enabled_tools=${JSON.stringify(tools)}`,
    ];
  });
}

function codexUsage(data) {
  if (!Number.isFinite(data?.inputTokens) || !Number.isFinite(data?.outputTokens)) return null;
  return {
    input: data.inputTokens, output: data.outputTokens, cached: data.cachedInputTokens ?? 0,
    total: data.totalTokens ?? data.inputTokens + data.outputTokens,
    ...(Number.isFinite(data.cacheWriteInputTokens) ? { cacheWrite: data.cacheWriteInputTokens } : {}),
    ...(Number.isFinite(data.reasoningOutputTokens) ? { reasoning: data.reasoningOutputTokens } : {}),
  };
}

class CodexEngine {
  constructor(exe, cwd, plugins, emit, { unattended = false, nativeExtensions = true, disabledServers = [] } = {}) {
    this.emit = emit;
    this.pending = new Map();
    this.approvals = new Map();
    this.questions = new Map();
    this.unattended = unattended;
    this.sequence = 0;
    const overrides = [
      ...pluginArguments(unattended ? [] : plugins),
      ...(!nativeExtensions || unattended ? ["-c", "features.plugins=false"] : []),
      ...(unattended ? ["-c", 'web_search="disabled"'] : []),
      ...disabledServers.flatMap((name) => ["-c", `mcp_servers.${name}.enabled=false`]),
    ];
    this.child = spawn(exe, ["app-server", "--listen", "stdio://", ...overrides], {
      cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    this.stderr = "";
    this.child.stderr.setEncoding("utf8").on("data", (part) => { this.stderr = (this.stderr + part).slice(-3000); });
    this.child.stdin.on("error", () => {});
    lineReader(this.child, (data) => this.receive(data));
    this.child.once("error", (error) => this.closed(error));
    this.exited = new Promise((resolve) => {
      this.child.once("exit", resolve);
      this.child.once("close", (code) => {
        this.closed(new Error(`Codex process closed (${code}). ${this.stderr.trim()}`));
        resolve();
      });
    });
  }

  write(data) {
    if (!this.child.stdin.writable) throw new Error("Codex is disconnected.");
    this.child.stdin.write(JSON.stringify(data) + "\n");
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not respond to ${method}.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "ai_deck", title: "AI Deck", version },
      ...(!this.unattended && { capabilities: { experimentalApi: true } }),
    });
    this.write({ method: "initialized" });
  }

  receive(message) {
    const { id, method, params = {} } = message;
    if (id !== undefined && !method) {
      const request = this.pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(id);
      if (message.error) request.reject(new Error(message.error.message ?? "Codex request failed.", { cause: message.error.data }));
      else request.resolve(message.result);
      return;
    }
    if (id !== undefined) {
      if (method === "item/tool/requestUserInput") {
        const active = this.active;
        const questions = readQuestions(params.questions, "codex");
        if (!active || this.unattended || active.stopping || !questions || params.threadId !== active.threadId ||
          (active.turnId && params.turnId !== active.turnId)) {
          this.write({ id, result: { answers: {} } });
          return;
        }
        const key = randomUUID();
        this.questions.set(key, { id, questions });
        this.emit({ type: "question", key, questions });
        return;
      }
      const supported = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(method);
      const detail = [params.command, params.reason, params.cwd, params.grantRoot].filter(Boolean).join("\n");
      if (!this.active || !supported || !detail || this.active.stopping) {
        this.write({ id, error: { code: -32601, message: "This approval cannot be presented in AI Deck." } });
        if (this.active && !this.active.stopping) this.emit({ type: "activity", text: `Approval unavailable for ${method}.` });
        return;
      }
      const key = randomUUID();
      this.approvals.set(key, id);
      this.emit({ type: "approval", key, title: method.includes("commandExecution") ? "Command approval" : "File change approval", text: detail,
        subject: params.command });
      return;
    }
    if (method === "serverRequest/resolved" && this.active?.threadId === params.threadId) {
      const entry = [...this.questions].find(([, question]) => question.id === params.requestId);
      if (entry) {
        this.questions.delete(entry[0]);
        this.emit({ type: "approval-cancelled", key: entry[0] });
      }
    }
    if (method === "account/rateLimits/updated" && (!params.rateLimits?.limitId || params.rateLimits.limitId === "codex")) {
      this.rateLimits = params.rateLimits;
    }
    const active = this.active;
    if (!active || params.threadId && params.threadId !== active.threadId) return;
    const turnId = params.turnId ?? params.turn?.id;
    if (active.turnId && turnId && active.turnId !== turnId) return;
    if (method === "turn/started") active.turnId = params.turn.id;
    if (method === "turn/started") this.emit({ type: "steer-ready" });
    if (method === "model/rerouted" && typeof params.toModel === "string") this.emit({ type: "run-model", model: params.toModel });
    if (method === "item/agentMessage/delta") this.emit({ type: "delta", key: params.itemId, text: params.delta });
    if (method === "turn/plan/updated" && Array.isArray(params.plan)) {
      const text = params.plan.map((entry) => `${{ completed: "✓", inProgress: "→", pending: "○" }[entry.status] ?? "·"} ${entry.step}`).join("\n");
      if (text) this.emit({ type: "activity", key: "plan:" + (turnId ?? ""), text: [params.explanation, text].filter(Boolean).join("\n") });
    }
    if (method === "item/started") {
      const item = params.item;
      if (item?.type === "commandExecution") {
        this.emit({ type: "activity", text: item.command, key: item.id });
        this.emit({ type: "command-start", command: item.command, key: item.id });
      }
      if (item?.type === "fileChange") this.emit({ type: "activity", text: "Updating workspace files.", key: item.id });
      if (item?.type === "mcpToolCall") this.emit({ type: "activity", text: `MCP · ${item.server} / ${item.tool}`, key: item.id });
    }
    if (method === "item/completed") {
      const item = params.item;
      if (item?.type === "imageGeneration" && typeof item.savedPath === "string") {
        this.emit({ type: "generated-image", filename: item.savedPath });
      }
      if (item?.type === "webSearch") {
        const link = item.action?.type === "openPage" ? item.action.url : null;
        this.emit({ type: "web-source", kind: link ? "fetch" : "search", detail: link || item.query });
      }
      if (item?.type === "agentMessage") this.emit({ type: "message", key: item.id, text: item.text });
      if (item?.type === "commandExecution") {
        this.emit({ type: "activity", text: [item.command, item.aggregatedOutput?.slice(-9000), item.exitCode == null ? "" : `Exit ${item.exitCode}`].filter(Boolean).join("\n"), key: item.id });
        this.emit({ type: "command-result", key: item.id, command: item.command, exitCode: item.exitCode, status: item.status, ...(typeof item.aggregatedOutput === "string" && { output: item.aggregatedOutput.slice(-9000) }) });
      }
    }
    if (method === "thread/tokenUsage/updated") {
      const usage = codexUsage(params.tokenUsage?.total);
      const lastRequest = codexUsage(params.tokenUsage?.last);
      if (usage) this.emit({ type: "usage", usage: { ...usage, ...(lastRequest && { lastRequest }) }, scope: "Thread total" });
    }
    if (method === "error" && !params.willRetry) {
      active.limitError = params.error;
      this.emit({ type: "activity", text: params.error?.message ?? "Codex reported an error." });
    }
    if (method === "turn/completed") {
      this.active = null;
      this.approvals.clear();
      this.questions.clear();
      const status = params.turn.status;
      const limit = status === "failed"
        ? codexLimit(params.turn.error, this.rateLimits) ?? codexLimit(active.limitError, this.rateLimits)
        : null;
      active.finish({ status: limit ? "limited" : status, error: params.turn.error?.message, ...(limit ? { limit } : {}) });
    }
  }

  async run(threadId, cwd, prompt, readOnly, preferences = {}) {
    if (this.active) throw new Error("Codex already has an active turn.");
    const done = new Promise((finish) => { this.active = { threadId, finish }; });
    const active = this.active;
    try {
      const result = await this.request("turn/start", {
        threadId, cwd, input: codexInput(prompt, preferences.images),
        approvalPolicy: preferences.unattended ? "never" : "on-request",
        sandboxPolicy: readOnly ? { type: "readOnly", networkAccess: false }
          : { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
        ...(preferences.model ? { model: preferences.model } : {}),
        ...(preferences.effort ? { effort: preferences.effort } : {}),
        ...(preferences.speed ? { serviceTierForTurn: preferences.speed === "fast" ? "priority" : "default" } : {}),
      });
      if (this.active === active) {
        active.turnId = result.turn.id;
        if (active.stopping) await this.interrupt();
        else this.emit({ type: "steer-ready" });
      }
      return await done;
    } catch (error) {
      if (this.active === active) this.active = null;
      if (active.stopping) return { status: "interrupted" };
      const limit = codexLimit({ ...error.cause, message: error.message }, this.rateLimits);
      if (limit) return { status: "limited", error: error.message, limit };
      throw error;
    }
  }

  decide(key, accept) {
    if (!this.approvals.has(key)) return false;
    const id = this.approvals.get(key);
    this.approvals.delete(key);
    this.write({ id, result: { decision: accept ? "accept" : "decline" } });
    return true;
  }

  answer(key, answers) {
    const request = this.questions.get(key);
    if (!request) return false;
    const values = answers === null ? [] : validateAnswers(request.questions, answers);
    const response = Object.fromEntries(values.map((selected, index) => [request.questions[index].id, { answers: selected }]));
    this.questions.delete(key);
    this.write({ id: request.id, result: { answers: response } });
    return true;
  }

  async steer(prompt, id, images) {
    const active = this.active;
    if (!active?.turnId || active.stopping) throw new Error("Codex has no active turn to steer.");
    const result = await this.request("turn/steer", {
      threadId: active.threadId, expectedTurnId: active.turnId, clientUserMessageId: id,
      input: codexInput(prompt, images),
    });
    if (result?.turnId !== active.turnId) throw new Error("Codex did not acknowledge steering this turn.");
  }

  async interrupt() {
    const active = this.active;
    if (!active) return;
    active.stopping = true;
    for (const key of this.approvals.keys()) this.decide(key, false);
    for (const key of this.questions.keys()) this.answer(key, null);
    if (active.turnId) await this.request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId });
  }

  closed(error) {
    this.dead = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.approvals.clear();
    this.questions.clear();
    const active = this.active;
    this.active = null;
    if (active) {
      const limit = active.stopping ? null : codexLimit(active.limitError, this.rateLimits);
      active.finish(active.stopping ? { status: "interrupted" } :
        { status: limit ? "limited" : "failed", error: active.limitError?.message ?? error.message, ...(limit ? { limit } : {}) });
    }
  }

  close() {
    this.child.kill();
  }

  async shutdown() {
    this.close();
    await this.exited;
  }
}

function claudeFileTools(role, interactive, allowCommands) {
  const tools = role === "write" ? ["Read", "Glob", "Grep", "Edit", "Write"] : role === "plan" ? ["Read", "Glob", "Grep"] : [];
  if (interactive && role !== "test") tools.push("AskUserQuestion");
  if (interactive && role === "write" && allowCommands) tools.push("Bash");
  return tools;
}

function claudeProjectPlugins(plugins, role) {
  return role === "review" ? plugins.filter((plugin) => plugin.enabled !== false && plugin.scope !== "codex") : [];
}

function claudeArguments(plugins, resume, options = {}) {
  const { role = "review", model, effort, speed, fallbackModel, outputStyle, interactive = false } = options;
  const settings = {
    ...(speed ? { fastMode: speed === "fast" } : {}),
    ...(outputStyle ? { outputStyle } : {}),
  };
  const selected = claudeProjectPlugins(plugins, role);
  const mcpServers = Object.fromEntries(selected.map(({ name, url }) => [name, { type: "http", url }]));
  const tools = selected.flatMap(({ name, tools }) => tools.map((tool) => `mcp__${name}__${tool}`));
  return [
    "-p", "--verbose", "--output-format", "stream-json", "--include-partial-messages",
    "--setting-sources", "", "--no-chrome",
    ...(options.accountUsage ? ["--no-session-persistence"] : ["--disable-slash-commands"]),
    "--tools", claudeFileTools(role, interactive, options.allowCommands).join(","),
    "--permission-mode", interactive ? "default" : role === "write" ? "acceptEdits" : "dontAsk", "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers }),
    ...(role === "review" ? [] : ["--restricted"]),
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(fallbackModel ? ["--fallback-model", fallbackModel] : []),
    ...(Object.keys(settings).length ? ["--settings", JSON.stringify(settings)] : []),
    ...(interactive ? ["--input-format", "stream-json", "--replay-user-messages", "--permission-prompts", "host"] : []),
    ...(tools.length && !interactive ? ["--allowedTools", tools.join(",")] : []),
    ...(resume ? ["--resume", resume] : []),
  ];
}

function inspectClaude(exe, cwd, accountUsage = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, claudeArguments([], null, { interactive: true, role: "test", accountUsage }), {
      cwd, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
    });
    const missing = accountUsage ? "Claude Code did not return a structured usage report. Open Claude account usage for current limits." :
      "Claude Code did not return its model list.";
    let response;
    let report;
    let sent = false;
    let completed = false;
    const write = (data) => child.stdin.write(JSON.stringify(data) + "\n");
    const timer = setTimeout(() => {
      reject(new Error(missing));
      child.kill();
    }, accountUsage ? 18_000 : 10_000);
    child.once("error", reject);
    child.stdin.on("error", (error) => { reject(error); child.kill(); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (accountUsage && code === 0 && completed && report) resolve(report);
      else if (!accountUsage && Array.isArray(response?.models)) resolve(response);
      else reject(new Error(missing));
    });
    lineReader(child, (message) => {
      if (message.response?.request_id === "deck-inspect") {
        response = message.response.response;
        if (accountUsage && !sent && response?.commands?.some((command) => command.name === "usage")) {
          sent = true;
          write({ type: "user", message: { role: "user", content: "/usage" }, parent_tool_use_id: null, session_id: "" });
        } else child.stdin.end();
      }
      if (!sent) return;
      if (message.type === "assistant" && message.usage_report) report = message.usage_report;
      if (message.type === "result") {
        completed = !message.is_error && message.num_turns === 0;
        child.stdin.end();
      }
    });
    write({ type: "control_request", request_id: "deck-inspect", request: { subtype: "initialize" } });
  });
}

function claudeUsage(data) {
  if (!Number.isFinite(data?.input_tokens) || !Number.isFinite(data?.output_tokens)) return null;
  const cached = data.cache_read_input_tokens ?? 0;
  const input = data.input_tokens + cached + (data.cache_creation_input_tokens ?? 0);
  return {
    input, output: data.output_tokens, cached, total: input + data.output_tokens,
    ...(Number.isFinite(data.cache_creation_input_tokens) ? { cacheWrite: data.cache_creation_input_tokens } : {}),
  };
}

function runClaude(exe, cwd, prompt, plugins, resume, emit, options = {}) {
  const { interactive = false, role = "review" } = options;
  const child = spawn(exe, claudeArguments(plugins, resume, options), {
    cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  let sessionId = resume;
  let stopped = false;
  let result;
  let limitEvent;
  let hasText = false;
  let stderr = "";
  let messageKey = "claude-0";
  let messageIndex = 0;
  let initialized = false;
  let remaining = 0;
  let finishTimer;
  let usageTotal;
  const controls = new Map();
  const approvals = new Map();
  const questions = new Map();
  const bashCalls = new Map();
  const acknowledgements = new Map();
  const fileTools = claudeFileTools(role, interactive, options.allowCommands);
  const mcpTools = claudeProjectPlugins(plugins, role).flatMap((plugin) => plugin.tools.map((tool) => `mcp__${plugin.name}__${tool}`));
  const allowed = new Set([...fileTools, ...mcpTools]);
  const ask = new Set(["Edit", "Write", "Bash", "AskUserQuestion", ...mcpTools]);
  const canSteer = () => Boolean(interactive && initialized && !stopped && remaining === 1 && child.stdin.writable);
  const write = (message) => {
    if (!child.stdin.writable) return false;
    child.stdin.write(JSON.stringify(message) + "\n");
    return true;
  };
  function respond(id, response) {
    return write({ type: "control_response", response: { subtype: "success", request_id: id, response } });
  }
  function control(request) {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { controls.delete(id); reject(new Error("Claude Code did not answer " + request.subtype + ".")); }, 8000);
      controls.set(id, { resolve, reject, timer });
      if (!write({ type: "control_request", request_id: id, request })) {
        clearTimeout(timer);
        controls.delete(id);
        reject(new Error("Claude Code is disconnected."));
      }
    });
  }
  function sendInput(content, id, followup = false) {
    remaining++;
    emit({ type: "steer-ready", ready: canSteer() });
    return write({ type: "user", uuid: id, parent_tool_use_id: null,
      ...(followup && { priority: "later" }), message: { role: "user", content } });
  }
  function handleControl(message) {
    if (message.type === "control_response") {
      const response = message.response;
      const pending = controls.get(response?.request_id);
      if (!pending) return;
      clearTimeout(pending.timer);
      controls.delete(response.request_id);
      if (response.subtype === "success") pending.resolve(response.response);
      else pending.reject(new Error(String(response.error ?? "Claude Code rejected the request.")));
    } else if (message.type === "control_cancel_request") {
      if (approvals.delete(message.request_id) || questions.delete(message.request_id)) emit({ type: "approval-cancelled", key: message.request_id });
    } else if (message.type === "control_request") {
      const request = message.request ?? {};
      const id = message.request_id;
      if (request.subtype === "hook_callback" && request.callback_id === "deck-tools") {
        const tool = request.input?.tool_name;
        const decision = stopped || !allowed.has(tool) ? "deny" : ask.has(tool) ? "ask" : undefined;
        return respond(id, decision ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision,
          permissionDecisionReason: "AI Deck tool policy" } } : {});
      }
      if (request.subtype === "can_use_tool" && !stopped && allowed.has(request.tool_name)) {
        if (request.tool_name === "AskUserQuestion") {
          if (questions.has(id)) return;
          const items = readQuestions(request.input?.questions, "claude");
          if (!items) return respond(id, { behavior: "deny", message: "AI Deck could not present the questions." });
          questions.set(id, { request, items });
          emit({ type: "question", key: id, questions: items });
          return;
        }
        if (approvals.has(id)) return;
        if (request.tool_name === "Bash") {
          const { command, run_in_background: background, dangerouslyDisableSandbox } = request.input ?? {};
          if (typeof command !== "string" || !command.trim() || command.length > 8000 || background || dangerouslyDisableSandbox) {
            return respond(id, { behavior: "deny", message: "Ask for one foreground command under 8,000 characters." });
          }
          approvals.set(id, request);
          emit({ type: "approval", key: id, title: "Run command in Git Bash", text: command, subject: command,
            note: "Runs with your Windows account access. Worktree: " + cwd });
          return;
        }
        approvals.set(id, request);
        emit({ type: "approval", key: id, title: request.tool_name, subject: request.input?.file_path,
          text: [request.decision_reason, JSON.stringify(request.input ?? {}, null, 2)].filter(Boolean).join("\n").slice(0, 3500) });
      } else if (request.subtype === "can_use_tool") {
        respond(id, { behavior: "deny", message: "This action is outside the approved AI Deck tool scope." });
      } else {
        write({ type: "control_response", response: { subtype: "error", request_id: id, error: "This request is unavailable in AI Deck." } });
      }
    }
  }
  function decide(key, accept) {
    const request = approvals.get(key);
    if (!request) return false;
    approvals.delete(key);
    const bashId = accept && request.tool_name === "Bash" && request.tool_use_id;
    if (bashId) {
      bashCalls.set(bashId, request.input.command);
      emit({ type: "command-start", command: request.input.command, key: bashId });
    }
    const sent = respond(key, accept ? { behavior: "allow", updatedInput: request.input, toolUseID: request.tool_use_id }
      : { behavior: "deny", message: "Declined in AI Deck." });
    if (!sent && bashId) bashCalls.delete(bashId);
    return sent;
  }
  function answer(key, answers) {
    const pending = questions.get(key);
    if (!pending) return false;
    const values = answers === null ? null : validateAnswers(pending.items, answers);
    questions.delete(key);
    if (!values) return respond(key, { behavior: "deny", message: "The user skipped these questions." });
    const submitted = Object.fromEntries(values.map((value, index) => [
      pending.items[index].id, pending.items[index].multi ? value : value[0],
    ]));
    return respond(key, { behavior: "allow", updatedInput: { ...pending.request.input, answers: submitted },
      toolUseID: pending.request.tool_use_id });
  }
  child.stderr.setEncoding("utf8").on("data", (part) => { stderr = (stderr + part).slice(-3500); });
  lineReader(child, (message) => {
    if (message.session_id) sessionId = message.session_id;
    if (interactive && typeof message.type === "string" && message.type.startsWith("control_")) return handleControl(message);
    if (interactive && message.type === "user" && message.isReplay === true) {
      const entry = acknowledgements.get(message.uuid);
      if (entry) {
        clearTimeout(entry.timer);
        acknowledgements.delete(message.uuid);
        entry.resolve();
      }
    }
    if (message.type === "rate_limit_event") {
      limitEvent = claudeLimitEvent(message.rate_limit_info) ?? limitEvent;
      const quota = claudeQuota(message.rate_limit_info);
      if (quota) emit({ type: "quota", quota });
    }
    if (message.type === "stream_event") {
      const event = message.event;
      if (event?.type === "message_start") messageKey = event.message?.id ?? `claude-${++messageIndex}`;
      if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && !message.parent_tool_use_id) {
        hasText = true;
        emit({ type: "delta", key: messageKey + "-" + event.index, text: event.delta.text });
      }
    }
    if (message.type === "assistant" && !message.parent_tool_use_id) {
      if (typeof message.message?.model === "string" && message.message.model !== "<synthetic>") {
        emit({ type: "run-model", model: message.message.model });
      }
      const blocks = message.message?.content ?? [];
      for (const [index, block] of blocks.entries()) {
        if (block.type === "text") {
          hasText = true;
          emit({ type: "message", key: (message.message?.id ?? messageKey) + "-" + index, text: block.text });
        }
        if (block.type === "tool_use") {
          const command = block.input?.command;
          emit({ type: "activity", key: block.id, text: block.name === "Bash" ? [block.name, command?.slice(0, 8000)].filter(Boolean).join("\n") : block.name });
          if (block.name === "Bash" && bashCalls.has(block.id)) emit({ type: "command-start", command, key: block.id });
          if (block.name === "WebSearch") emit({ type: "web-source", kind: "search", detail: block.input?.query });
          if (block.name === "WebFetch") emit({ type: "web-source", kind: "fetch", detail: block.input?.url });
        }
      }
    }
    if (interactive && options.allowCommands && message.type === "user" && !message.parent_tool_use_id) {
      const content = message.message?.content;
      if (Array.isArray(content)) for (const item of content) {
        const command = item.type === "tool_result" && bashCalls.get(item.tool_use_id);
        if (!command) continue;
        bashCalls.delete(item.tool_use_id);
        const output = typeof item.content === "string" ? item.content : (Array.isArray(item.content)
          ? item.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "");
        emit({ type: "activity", key: "output-" + item.tool_use_id,
          text: (item.is_error ? "Command reported an error" : "Command output") + (output ? "\n" + output.slice(-9000) : "") });
        emit({ type: "command-result", key: item.tool_use_id, command, status: item.is_error === true ? "failed" : "returned", output: output.slice(-9000) });
      }
    }
    if (message.type === "result") {
      result = message;
      const usage = claudeUsage(message.usage);
      if (usage) {
        usageTotal ??= {};
        for (const [key, value] of Object.entries(usage)) usageTotal[key] = (usageTotal[key] ?? 0) + value;
        const sessionEstimateUsd = message.total_cost_usd;
        emit({ type: "usage", usage: { ...usageTotal, ...(Number.isFinite(sessionEstimateUsd) && sessionEstimateUsd >= 0 && { sessionEstimateUsd }) },
          scope: interactive ? "AI Deck run" : "CLI result" });
      }
      if (!hasText && !message.is_error && message.result) emit({ type: "message", text: message.result });
      if (message.is_error) emit({ type: "activity", text: message.result ?? message.errors?.join("\n") ?? message.subtype });
      if (interactive) {
        hasText = false;
        remaining = Math.max(0, remaining - 1);
        if (stopped || message.is_error || remaining === 0) child.stdin.end();
        emit({ type: "steer-ready", ready: canSteer() });
      }
    }
  });
  child.stdin.on("error", () => {});
  if (interactive) {
    void control({ subtype: "initialize", hooks: { PreToolUse: [{ matcher: ".*", hookCallbackIds: ["deck-tools"] }] } }).then(() => {
      initialized = true;
      if (stopped) child.stdin.end();
      else sendInput(claudeInput(prompt, options.images), randomUUID());
    }).catch((error) => { stderr = error.message; child.kill(); });
  } else child.stdin.end(prompt, "utf8");
  const done = new Promise((resolve) => {
    child.once("error", (error) => resolve({ status: "failed", error: error.message, sessionId }));
    child.once("close", (code) => {
      clearTimeout(finishTimer);
      for (const entry of [...controls.values(), ...acknowledgements.values()]) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Claude Code closed before acknowledging the request."));
      }
      controls.clear();
      acknowledgements.clear();
      const completed = Boolean(code === 0 && result && !result.is_error && (!interactive || remaining === 0));
      const error = stopped || completed ? undefined : result?.result ?? result?.errors?.join("\n") ?? (stderr.trim() || `Claude Code exited (${code}).`);
      const limit = stopped || completed ? null : limitEvent ?? textLimit(error);
      resolve({
        status: stopped ? "interrupted" : completed ? "completed" : limit ? "limited" : "failed",
        error, sessionId, answer: completed ? result.result : undefined,
        ...(limit ? { limit } : {}),
      });
    });
  });
  return {
    done, canSteer, decide, answer,
    close() {
      stopped = true;
      child.kill();
    },
    steer(text, id, images) {
      if (!canSteer()) throw new Error("Claude Code cannot accept another follow-up right now.");
      const content = claudeInput(text, images);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          acknowledgements.delete(id);
          reject(new Error("Claude Code did not acknowledge the follow-up. Check the conversation before resending."));
        }, 30000);
        acknowledgements.set(id, { resolve, reject, timer });
        sendInput(content, id, true);
      });
    },
    async stop() {
      if (stopped || child.exitCode != null || child.signalCode != null) return;
      stopped = true;
      emit({ type: "steer-ready", ready: false });
      if (!interactive || !initialized) { child.kill(); return; }
      for (const key of approvals.keys()) decide(key, false);
      for (const key of questions.keys()) answer(key, null);
      finishTimer = setTimeout(() => child.kill(), 3500);
      try { await control({ subtype: "interrupt" }); child.stdin.end(); } catch { child.kill(); }
    },
  };
}

module.exports = { capture, CodexEngine, runClaude, inspectClaude, claudeArguments, claudeFileTools, claudeProjectPlugins, codexUsage, claudeUsage };
