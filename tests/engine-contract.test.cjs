const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { mock, test } = require("node:test");

class FakeCli extends EventEmitter {
  constructor(onInput, onEnd) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new Writable({
      write: (chunk, _encoding, done) => {
        onInput?.(this, chunk.toString());
        done();
      },
      final: (done) => { onEnd?.(this); done(); },
    });
  }
  send(data) {
    this.stdout.write(JSON.stringify(data) + "\n");
  }
  kill() {
    this.stdout.end();
    this.stderr.end();
    this.emit("close", 0);
  }
}

test("Codex routes an approval, streams content, and reports provider usage", async () => {
  const processes = require("node:child_process");
  let decision;
  const replace = mock.method(processes, "spawn", () => new FakeCli((child, line) => {
    const message = JSON.parse(line);
    if (message.method === "initialize") child.send({ id: message.id, result: {} });
    if (message.method === "turn/start") {
      assert.equal(message.params.sandboxPolicy.networkAccess, false);
      assert.equal(message.params.model, "gpt-fixture");
      assert.equal(message.params.effort, "ultra");
      assert.equal(message.params.serviceTierForTurn, "priority");
      child.send({ id: message.id, result: { turn: { id: "turn-1" } } });
      child.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Hello" } });
      child.send({ id: "approve-1", method: "item/commandExecution/requestApproval", params: { command: "git status" } });
    }
    if (message.id === "approve-1" && message.result) {
      decision = message.result.decision;
      child.send({ method: "item/started", params: { threadId: "thread-1", turnId: "turn-1",
        item: { id: "command-1", type: "commandExecution", command: "git status" } } });
      child.send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1",
        item: { id: "command-1", type: "commandExecution", command: "git status", exitCode: 0, status: "completed" } } });
      child.send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1",
        item: { id: "search-1", type: "webSearch", query: "fixture search" } } });
      child.send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1",
        item: { id: "image-1", type: "imageGeneration", status: "completed", savedPath: "C:/fixture/output.png" } } });
      child.send({ id: "question-1", method: "item/tool/requestUserInput", params: {
        threadId: "thread-1", turnId: "turn-1", questions: [{ id: "output", question: "Choose an output",
          header: "Output", options: [{ label: "Summary", description: "Brief" }] }],
      } });
    }
    if (message.id === "question-1" && message.result) {
      assert.deepEqual(message.result, { answers: { output: { answers: ["Summary"] } } });
      child.send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1", tokenUsage: { total: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, totalTokens: 15 } } } });
      child.send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
    }
  }));
  const { CodexEngine } = require("../desktop/engines.cjs");
  const events = [];
  const engine = new CodexEngine("fixture.exe", process.cwd(), [], (event) => {
    events.push(event);
    if (event.type === "approval") queueMicrotask(() => engine.decide(event.key, true));
    if (event.type === "question") queueMicrotask(() => {
      assert.throws(() => engine.answer(event.key, [["Invalid"]]), /valid answer/);
      assert.equal(engine.answer(event.key, [["Summary"]]), true);
      assert.equal(engine.answer(event.key, [["Summary"]]), false);
    });
  });
  try {
    await engine.initialize();
    assert.equal((await engine.run("thread-1", process.cwd(), "Test", false, { model: "gpt-fixture", effort: "ultra", speed: "fast" })).status, "completed");
    assert.equal(decision, "accept");
    assert.deepEqual(events.find((item) => item.type === "command-result"),
      { type: "command-result", key: "command-1", command: "git status", exitCode: 0, status: "completed" });
    assert.equal(events.find((item) => item.type === "command-start").command, "git status");
    assert.equal(events.find((item) => item.type === "web-source").detail, "fixture search");
    assert.equal(events.find((item) => item.type === "generated-image").filename, "C:/fixture/output.png");
    assert.equal(events.find((item) => item.type === "delta").text, "Hello");
    assert.deepEqual(events.find((item) => item.type === "usage").usage, { input: 10, output: 5, cached: 4, total: 15 });
  } finally {
    engine.close();
    replace.mock.restore();
    delete require.cache[require.resolve("../desktop/engines.cjs")];
  }
});

test("Claude consumes newline-delimited result usage and exposes the final answer", async () => {
  const processes = require("node:child_process");
  const replace = mock.method(processes, "spawn", (_exe, args) => {
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(args.includes("--tools"));
    assert.equal(args[args.indexOf("--model") + 1], "sonnet");
    assert.equal(args[args.indexOf("--effort") + 1], "low");
    assert.equal(args[args.indexOf("--fallback-model") + 1], "haiku");
    assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { fastMode: false, outputStyle: "Concise" });
    return new FakeCli(null, (child) => queueMicrotask(() => {
      child.send({ type: "result", session_id: "session-1", result: "Review complete", is_error: false,
        total_cost_usd: 0.00125,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } });
      child.kill();
    }));
  });
  const { runClaude } = require("../desktop/engines.cjs");
  const events = [];
  try {
    const run = runClaude("fixture.exe", process.cwd(), "Review", [], undefined, (event) => events.push(event),
      { model: "sonnet", effort: "low", speed: "standard", fallbackModel: "haiku", outputStyle: "Concise" });
    const result = await run.done;
    assert.equal(result.status, "completed");
    assert.equal(result.answer, "Review complete");
    assert.equal(result.sessionId, "session-1");
    assert.deepEqual(events.find((item) => item.type === "usage").usage, { input: 16, output: 5, cached: 4, total: 21, cacheWrite: 2,
      sessionEstimateUsd: 0.00125 });
    assert.equal(events.find((item) => item.type === "message").text, "Review complete");
  } finally {
    replace.mock.restore();
  }
});

test("interactive Claude enforces tool scope and acknowledges a follow-up before settling", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const reply = (child, id, result = {}) => child.send({ type: "control_response", response: { request_id: id, subtype: "success", response: result } });
  const result = (child, text) => child.send({ type: "result", session_id: "session-1", result: text, is_error: false,
    usage: { input_tokens: 10, output_tokens: 5 } });
  const replace = mock.method(processes, "spawn", (_exe, args) => {
    assert.ok(args.includes("--input-format"));
    assert.ok(args.includes("--replay-user-messages"));
    return new FakeCli((child, line) => {
      const message = JSON.parse(line);
      if (message.request?.subtype === "initialize") {
        assert.equal(message.request.hooks.PreToolUse[0].hookCallbackIds[0], "deck-tools");
        reply(child, message.request_id);
      } else if (message.type === "user" && !message.priority) {
        child.send({ type: "control_request", request_id: "blocked", request: { subtype: "hook_callback",
          callback_id: "deck-tools", input: { tool_name: "Bash" } } });
      } else if (message.response?.request_id === "blocked") {
        assert.equal(message.response.response.hookSpecificOutput.permissionDecision, "deny");
        child.send({ type: "control_request", request_id: "edit", request: { subtype: "can_use_tool", tool_name: "Edit", input: { file_path: "demo.js" } } });
      } else if (message.type === "user" && message.priority === "later") {
        child.send({ ...message, isReplay: true });
      } else if (message.response?.request_id === "edit") {
        assert.equal(message.response.response.behavior, "allow");
        result(child, "Initial result");
        result(child, "Follow-up result");
      }
    }, (child) => queueMicrotask(() => child.kill()));
  });
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { runClaude } = require(filename);
  const events = [];
  let releaseApproval;
  const approval = new Promise((resolve) => { releaseApproval = resolve; });
  const run = runClaude("fixture.exe", process.cwd(), "Edit demo", [], undefined, (event) => {
    events.push(event);
    if (event.type === "approval") releaseApproval(event);
  }, { interactive: true, role: "write" });
  try {
    const { key } = await approval;
    assert.equal(run.canSteer(), true);
    await run.steer("Check the fix", "follow-up-1");
    assert.equal(run.canSteer(), false);
    assert.equal(run.decide(key, true), true);
    assert.equal((await run.done).answer, "Follow-up result");
    assert.equal(events.filter((event) => event.type === "usage").at(-1).usage.total, 30);
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("agent scopes exclude disabled and other-agent MCP servers", () => {
  const { claudeArguments } = require("../desktop/engines.cjs");
  const url = "https://example.invalid/mcp";
  const args = claudeArguments([
    { name: "shared", url, tools: ["search"] },
    { name: "writer", url, tools: ["patch"], scope: "codex" },
    { name: "reader", url, tools: ["get"], scope: "claude" },
    { name: "off", url, tools: ["get"], enabled: false },
  ]);
  assert.deepEqual(Object.keys(JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers), ["shared", "reader"]);
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__shared__search,mcp__reader__get");
});

test("Claude answers a clarification before requesting a foreground check", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const questions = [{ question: "What should I test?", multiSelect: true, options: [{ label: "Build" }, { label: "Lint" }] }];
  const replace = mock.method(processes, "spawn", (_exe, args) => {
    assert.match(args[args.indexOf("--tools") + 1], /AskUserQuestion,Bash$/u);
    return new FakeCli((child, line) => {
      const frame = JSON.parse(line);
      if (frame.request?.subtype === "initialize") {
        child.send({ type: "control_response", response: { request_id: frame.request_id, subtype: "success", response: {} } });
      } else if (frame.type === "user") {
        child.send({ type: "control_request", request_id: "ask", request: { subtype: "can_use_tool",
          tool_name: "AskUserQuestion", input: { questions }, tool_use_id: "ask-tool" } });
      } else if (frame.response?.request_id === "ask") {
        assert.deepEqual(frame.response.response.updatedInput.answers, { "What should I test?": ["Build", "Lint"] });
        child.send({ type: "control_request", request_id: "run-check", request: { subtype: "can_use_tool",
          tool_name: "Bash", input: { command: "npm test" }, tool_use_id: "bash-tool" } });
      } else if (frame.response?.request_id === "run-check") {
        assert.equal(frame.response.response.behavior, "allow");
        child.send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "bash-tool", content: "test output" }] } });
        child.send({ type: "result", result: "Checks finished", is_error: false });
      }
    }, (child) => queueMicrotask(() => child.kill()));
  });
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { runClaude } = require(filename);
  const events = [];
  const run = runClaude("fixture.exe", process.cwd(), "Test", [], null, (event) => {
    events.push(event);
    if (event.type === "question") queueMicrotask(() => run.answer(event.key, [["Build", "Lint"]]));
    if (event.type === "approval") queueMicrotask(() => run.decide(event.key, true));
  }, { interactive: true, role: "write", allowCommands: true });
  try {
    assert.equal((await run.done).answer, "Checks finished");
    assert.equal(events.find((event) => event.type === "approval").text, "npm test");
    assert.ok(events.some((event) => event.text?.includes("test output")));
    assert.deepEqual(events.find((event) => event.type === "command-result"), {
      type: "command-result", key: "bash-tool", command: "npm test", status: "returned", output: "test output",
    });
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("Claude edit and plan use restricted file tools and cannot inherit MCP", () => {
  const { claudeArguments } = require("../desktop/engines.cjs");
  const plugin = { name: "test", url: "https://example.invalid/mcp", tools: ["patch"] };
  const write = claudeArguments([plugin], "write-session", { role: "write", model: "sonnet", effort: "high" });
  const plan = claudeArguments([plugin], "plan-session", { role: "plan" });
  const arg = (args, flag) => args[args.indexOf(flag) + 1];
  assert.equal(arg(write, "--tools"), "Read,Glob,Grep,Edit,Write");
  assert.equal(arg(plan, "--tools"), "Read,Glob,Grep");
  assert.equal(arg(write, "--permission-mode"), "acceptEdits");
  assert.equal(arg(plan, "--permission-mode"), "dontAsk");
  assert.ok(write.includes("--restricted") && plan.includes("--restricted"));
  assert.deepEqual(JSON.parse(arg(write, "--mcp-config")), { mcpServers: {} });
  assert.equal(arg(write, "--model"), "sonnet");
  assert.equal(arg(write, "--resume"), "write-session");
});

test("Codex maps a terminal usage-limit notification and its exhausted window", async () => {
  const processes = require("node:child_process");
  const resetsAt = Math.floor(Date.now() / 1000) + 1800;
  const replace = mock.method(processes, "spawn", () => new FakeCli((child, line) => {
    const request = JSON.parse(line);
    if (request.method !== "turn/start") return;
    child.send({ id: request.id, result: { turn: { id: "limit-turn" } } });
    child.send({ method: "account/rateLimits/updated", params: { rateLimits: { limitId: "codex", primary: { usedPercent: 100, resetsAt } } } });
    child.send({ method: "error", params: { threadId: "thread", turnId: "limit-turn", willRetry: false, error: { codexErrorInfo: "usageLimitExceeded", message: "Limit reached" } } });
    child.send({ method: "turn/completed", params: { threadId: "thread", turn: { id: "limit-turn", status: "failed" } } });
  }));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { CodexEngine } = require(filename);
  const engine = new CodexEngine("fixture.exe", process.cwd(), [], () => {});
  try {
    const result = await engine.run("thread", process.cwd(), "Test", true);
    assert.equal(result.status, "limited");
    assert.equal(result.limit.resetAt, resetsAt * 1000);
  } finally {
    engine.close();
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("Claude maps credits-required rejection to an untimed usage hold", async () => {
  const processes = require("node:child_process");
  const replace = mock.method(processes, "spawn", () => new FakeCli(null, (child) => queueMicrotask(() => {
    child.send({ type: "rate_limit_event", rate_limit_info: { status: "rejected", errorCode: "credits_required" } });
    child.send({ type: "result", is_error: true, session_id: "limit-session", errors: ["Quota"] });
    child.kill();
  })));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { runClaude } = require(filename);
  try {
    const result = await runClaude("fixture.exe", process.cwd(), "Review", [], undefined, () => {}).done;
    assert.equal(result.status, "limited");
    assert.equal(result.limit.kind, "credits");
    assert.equal(result.limit.resetAt, null);
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("Steer waits for Codex to acknowledge the exact active turn", async () => {
  const processes = require("node:child_process");
  let steerInput;
  const replace = mock.method(processes, "spawn", () => new FakeCli((child, line) => {
    const { id, method, params } = JSON.parse(line);
    if (method === "turn/start") child.send({ id, result: { turn: { id: "turn-1" } } });
    if (method === "turn/steer") {
      steerInput = params;
      child.send({ id, result: { turnId: "turn-1" } });
      child.send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
    }
  }));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { CodexEngine } = require(filename);
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const engine = new CodexEngine("fixture.exe", process.cwd(), [], (event) => {
    if (event.type === "steer-ready") started();
  });
  try {
    await assert.rejects(engine.steer("Too soon", "queue-1"), /no active turn/u);
    const turn = engine.run("thread-1", process.cwd(), "Check retry", false);
    await ready;
    await engine.steer("Include the concurrent case", "queue-1");
    assert.deepEqual(steerInput, {
      threadId: "thread-1", expectedTurnId: "turn-1", clientUserMessageId: "queue-1",
      input: [{ type: "text", text: "Include the concurrent case" }],
    });
    assert.equal((await turn).status, "completed");
    await assert.rejects(engine.steer("Too late", "queue-2"), /no active turn/u);
  } finally {
    engine.close();
    replace.mock.restore();
    delete require.cache[filename];
  }
});
