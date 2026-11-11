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
      assert.equal(message.params.summary, "concise");
      assert.equal(message.params.serviceTierForTurn, "priority");
      child.send({ id: message.id, result: { turn: { id: "turn-1" } } });
      child.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Hello" } });
      child.send({ method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1",
        item: { id: "summary-1", type: "reasoning", summary: ["Provider summary"], content: ["Internal text"] } } });
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
      const previous = { inputTokens: 6, outputTokens: 4, cachedInputTokens: 3, totalTokens: 10 };
      const latest = { inputTokens: 10, outputTokens: 5, cachedInputTokens: 4, totalTokens: 15 };
      for (const total of [previous, latest, latest]) {
        child.send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1",
          tokenUsage: { total, last: { inputTokens: 4, outputTokens: 1, cachedInputTokens: 1, totalTokens: 5 } } } });
      }
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
    assert.equal(replace.mock.calls[0].arguments[1].includes("features.prefer_mxc=true"), process.platform === "win32");
    await engine.initialize();
    assert.equal((await engine.run("thread-1", process.cwd(), "Test", false, { model: "gpt-fixture", effort: "ultra", speed: "fast", summary: "concise" })).status, "completed");
    assert.equal(decision, "accept");
    assert.deepEqual(events.find((item) => item.type === "command-result"),
      { type: "command-result", key: "command-1", command: "git status", exitCode: 0, status: "completed" });
    assert.equal(events.find((item) => item.type === "command-start").command, "git status");
    assert.equal(events.find((item) => item.type === "web-source").detail, "fixture search");
    assert.equal(events.find((item) => item.type === "generated-image").filename, "C:/fixture/output.png");
    assert.equal(events.find((item) => item.type === "delta").text, "Hello");
    assert.equal(events.find((item) => item.key === "reasoning:summary-1").text, "Reasoning summary\nProvider summary");
    assert.doesNotMatch(JSON.stringify(events), /Internal text/u);
    assert.equal(events.filter((item) => item.type === "provider-call").length, 1);
    assert.deepEqual(events.filter((item) => item.type === "provider-usage").map((item) => item.usage),
      [{ input: 8, output: 2, cached: 2, total: 10 }]);
    assert.equal(events.findLast((item) => item.type === "usage").usage.total, 15);
  } finally {
    engine.close();
    replace.mock.restore();
    delete require.cache[require.resolve("../desktop/engines.cjs")];
  }
});

test("Codex stop settles when the CLI acknowledges interrupt without completing the turn", { timeout: 8000 }, async () => {
  const processes = require("node:child_process");
  const replace = mock.method(processes, "spawn", () => new FakeCli((child, line) => {
    const { id, method } = JSON.parse(line);
    if (method === "turn/start") child.send({ id, result: { turn: { id: "turn-1" } } });
    if (method === "turn/interrupt") child.send({ id, result: {} });
  }));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { CodexEngine } = require(filename);
  const { promise: started, resolve: ready } = Promise.withResolvers();
  const engine = new CodexEngine("fixture.exe", process.cwd(), [], (event) => {
    if (event.type === "steer-ready") ready();
  });
  try {
    const turn = engine.run("thread-1", process.cwd(), "Check stop", false);
    await started;
    await engine.interrupt();
    assert.equal((await turn).status, "interrupted");
  } finally {
    engine.close();
    replace.mock.restore();
    delete require.cache[filename];
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

test("Claude preserves the final answer if its CLI stays alive after result", { timeout: 8000 }, async () => {
  const processes = require("node:child_process");
  const replace = mock.method(processes, "spawn", () => {
    const child = new FakeCli(null, () => queueMicrotask(() =>
      child.send({ type: "result", session_id: "session-final", result: "Finished", is_error: false })));
    child.kill = () => child.emit("close", null);
    return child;
  });
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  try {
    const { runClaude } = require(filename);
    const result = await runClaude("fixture.exe", process.cwd(), "Review", [], undefined, () => {}).done;
    assert.equal(result.status, "completed");
    assert.equal(result.sessionId, "session-final");
    assert.equal(result.answer, "Finished");
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("Claude stops repeated raw tool text mid-stream without accepting it as a command", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const invocation = '<invoke name="Bash">\n<parameter name="command">git status</parameter>\n</invoke>\n';
  const replace = mock.method(processes, "spawn", (_exe, args) => {
    assert.equal(args[args.indexOf("--tools") + 1], "AskUserQuestion");
    return new FakeCli((child, line) => {
      const input = JSON.parse(line);
      if (input.request?.subtype === "initialize") {
        child.send({ type: "control_response", response: { request_id: input.request_id, subtype: "success" } });
      } else if (input.type === "user") {
        assert.match(input.message.content, /answer directly/u);
        const sendDelta = (text) => child.send({ type: "stream_event", event: {
          type: "content_block_delta", index: 0, delta: { type: "text_delta", text },
        } });
        const repeated = invocation.repeat(3);
        sendDelta(repeated.slice(0, -6));
        sendDelta(repeated.slice(-6));
        // The provider never sends a result and does not exit on its own.
      }
    });
  });
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  try {
    const { runClaude } = require(filename);
    const events = [];
    const run = runClaude("fixture.exe", process.cwd(), "สวัสดี ทีมฉัน", [], undefined, (event) => events.push(event),
      { interactive: true });
    const result = await run.done;
    assert.equal(result.status, "failed");
    assert.match(result.error, /same tool invocation as text/u);
    assert.equal(result.answer, undefined);
    assert.equal(run.canSteer(), false);
    assert.equal(events.some((event) => event.type === "command-start" || event.type === "approval"), false);
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("Claude final snapshots do not count streamed text twice", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const text = '<invoke name="Read"><parameter name="file_path">example.js</parameter></invoke>\n'.repeat(2);
  const replace = mock.method(processes, "spawn", () => new FakeCli(null, (child) => queueMicrotask(() => {
    child.send({ type: "stream_event", event: { type: "message_start", message: { id: "fixture-answer" } } });
    child.send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
    child.send({ type: "assistant", message: { id: "fixture-answer", content: [{ type: "text", text }] } });
    child.send({ type: "result", result: text, is_error: false });
    child.kill();
  })));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  try {
    const { runClaude } = require(filename);
    const result = await runClaude("fixture.exe", process.cwd(), "Show a short XML example", [], undefined, () => {}).done;
    assert.equal(result.status, "completed");
    assert.equal(result.answer, text);
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("Claude finalizes each streamed text block in place after separate thinking snapshots", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const id = "msg-thinking";
  const replace = mock.method(processes, "spawn", () => new FakeCli(null, (child) => queueMicrotask(() => {
    const stream = (event, parent_tool_use_id = null) => child.send({ type: "stream_event", parent_tool_use_id, event });
    const snapshot = (block) => child.send({ type: "assistant", message: { id, content: [block] } });
    stream({ type: "message_start", message: { id } });
    stream({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
    snapshot({ type: "thinking", thinking: "private fixture reasoning" });
    for (const index of [1, 2]) {
      stream({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      stream({ type: "content_block_delta", index, delta: { type: "text_delta", text: "Same " } });
      stream({ type: "message_start", message: { id: "nested" } }, "tool-1");
      stream({ type: "content_block_delta", index, delta: { type: "text_delta", text: "reply" } });
      snapshot({ type: "text", text: "Same reply" });
      stream({ type: "content_block_stop", index });
    }
    stream({ type: "content_block_start", index: 3, content_block: { type: "tool_use" } });
    snapshot({ type: "text", text: "Same reply" });
    const finish = { type: "result", uuid: "final", result: "Same reply\n\nSame reply", is_error: false, usage: { input_tokens: 10, output_tokens: 2 } };
    child.send(finish);
    child.send(finish);
    child.kill();
  })));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  try {
    const { runClaude } = require(filename);
    const rows = new Map();
    const usage = [];
    const run = runClaude("fixture.exe", process.cwd(), "Review", [], undefined, ({ type, key, text }) => {
      if (type === "delta") rows.set(key, (rows.get(key) ?? "") + text);
      if (type === "message") rows.set(key, text);
      if (type === "provider-usage") usage.push(type);
    });
    assert.equal((await run.done).status, "completed");
    assert.deepEqual([...rows], [[id + "-1", "Same reply"], [id + "-2", "Same reply"]]);
    assert.equal(usage.length, 1);
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
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

test("Claude permits the turn-scoped window bridge while rejecting unrelated tools", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const hook = (child, id, tool_name) => child.send({ type: "control_request", request_id: id,
    request: { subtype: "hook_callback", callback_id: "deck-tools", input: { tool_name } } });
  const replace = mock.method(processes, "spawn", (_exe, args) => {
    assert.ok(args.includes("--no-session-persistence"));
    return new FakeCli((child, line) => {
      const message = JSON.parse(line);
      if (message.request?.subtype === "initialize") {
        child.send({ type: "control_response", response: { request_id: message.request_id, subtype: "success", response: {} } });
      } else if (message.type === "user") {
        hook(child, "window", "mcp__ai_deck_computer__screenshot");
      } else if (message.response?.request_id === "window") {
        assert.equal(message.response.response.hookSpecificOutput.permissionDecision, "allow");
        hook(child, "other", "mcp__other__screenshot");
      } else if (message.response?.request_id === "other") {
        assert.equal(message.response.response.hookSpecificOutput.permissionDecision, "deny");
        child.send({ type: "result", result: "Complete", is_error: false });
      }
    }, (child) => queueMicrotask(() => child.kill()));
  });
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  try {
    const { runClaude } = require(filename);
    const result = await runClaude("fixture.exe", process.cwd(), "Inspect the fixture",
      [{ name: "ai_deck_computer", url: "http://127.0.0.1:1024/fixture", tools: ["screenshot"] }],
      undefined, () => {}, { interactive: true, computer: true }).done;
    assert.equal(result.status, "completed");
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
});

test("approved Claude edits can write inside the worktree and cannot escape it", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const path = require("node:path");
  const cwd = process.cwd();
  const targets = [["src/new.js", "allow"], ["tests/peer.js", "deny"], ["../outside.js", "deny"], [".git/config", "deny"], ["src/new.js:stream", "deny"]];
  const checked = [];
  const replace = mock.method(processes, "spawn", () => new FakeCli((child, line) => {
    const message = JSON.parse(line);
    if (message.request?.subtype === "initialize") {
      child.send({ type: "control_response", response: { request_id: message.request_id, subtype: "success", response: {} } });
    } else if (message.type === "user") {
      for (const [index, [filename]] of targets.entries()) {
        child.send({ type: "control_request", request_id: String(index), request: { subtype: "hook_callback", callback_id: "deck-tools",
          input: { tool_name: "Write", tool_input: { file_path: path.resolve(cwd, filename) } } } });
      }
    } else {
      const index = Number(message.response?.request_id);
      checked[index] = message.response?.response?.hookSpecificOutput?.permissionDecision;
      if (checked.filter(Boolean).length === targets.length) child.send({ type: "result", result: "Done", is_error: false });
    }
  }, (child) => queueMicrotask(() => child.kill())));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { runClaude } = require(filename);
  try {
    const run = runClaude("fixture.exe", cwd, "Write the fixture", [], undefined, () => {},
      { interactive: true, role: "write", approvedWorkspaceEdits: true, writePaths: ["src/"] });
    assert.equal((await run.done).status, "completed");
    assert.deepEqual(checked, targets.map(([, decision]) => decision));
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
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

test("Claude writers receive selected MCP tools while planners receive declared read tools", () => {
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
  assert.deepEqual(JSON.parse(arg(write, "--mcp-config")), { mcpServers: { test: { type: "http", url: plugin.url } } });
  assert.deepEqual(JSON.parse(arg(plan, "--mcp-config")), { mcpServers: {} });
  const read = claudeArguments([{ ...plugin, tools: ["read", "patch"], readTools: ["read"] }], null, { role: "plan" });
  assert.equal(arg(read, "--allowedTools"), "mcp__test__read");
  assert.equal(arg(write, "--model"), "sonnet");
  assert.equal(arg(write, "--resume"), "write-session");
});

test("one-shot Claude conversations keep streaming with no tools, MCP or saved session", () => {
  const { claudeArguments } = require("../desktop/engines.cjs");
  const plugin = { name: "test", url: "https://example.invalid/mcp", tools: ["patch"] };
  const args = claudeArguments([plugin], null, { role: "test", persistSession: false });
  const arg = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(arg("--tools"), "");
  assert.equal(arg("--setting-sources"), "");
  assert.equal(arg("--permission-mode"), "dontAsk");
  assert.equal(arg("--output-format"), "stream-json");
  assert.deepEqual(JSON.parse(arg("--mcp-config")), { mcpServers: {} });
  for (const flag of ["--restricted", "--no-session-persistence", "--include-partial-messages"]) assert.ok(args.includes(flag));
  assert.ok(!args.includes("--input-format") && !args.includes("--permission-prompts"));
});

test("Claude surfaces Bash hook requests and records the result only after approval", { timeout: 5000 }, async () => {
  const processes = require("node:child_process");
  const command = "node --test test/example.test.cjs";
  const hook = (child, id, input) => child.send({ type: "control_request", request_id: id, request: {
    subtype: "hook_callback", callback_id: "deck-tools",
    input: { tool_name: "Bash", tool_use_id: id + "-tool", tool_input: input },
  } });
  const replace = mock.method(processes, "spawn", () => new FakeCli((child, line) => {
    const frame = JSON.parse(line);
    if (frame.request?.subtype === "initialize") {
      child.send({ type: "control_response", response: { request_id: frame.request_id, subtype: "success", response: {} } });
    } else if (frame.type === "user") {
      hook(child, "background", { command, run_in_background: true });
    } else if (frame.response?.request_id === "background") {
      assert.equal(frame.response.response.hookSpecificOutput.permissionDecision, "deny");
      hook(child, "test", { command });
    } else if (frame.response?.request_id === "test") {
      assert.equal(frame.response.response.hookSpecificOutput.permissionDecision, "allow");
      child.send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "test-tool", content: "1 test passed" }] } });
      child.send({ type: "result", result: "Passed", is_error: false });
    }
  }, (child) => queueMicrotask(() => child.kill())));
  const filename = require.resolve("../desktop/engines.cjs");
  delete require.cache[filename];
  const { runClaude } = require(filename);
  const events = [];
  const run = runClaude("fixture.exe", process.cwd(), "Run the check", [], null, (event) => {
    events.push(event);
    if (event.type === "approval") queueMicrotask(() => run.decide(event.key, true));
  }, { interactive: true, role: "write", allowCommands: true });
  try {
    assert.equal((await run.done).answer, "Passed");
    assert.deepEqual(events.filter((event) => event.type === "approval").map(({ key }) => key), ["test"]);
    assert.equal(events.find((event) => event.type === "approval").commandId, "test-tool");
    assert.deepEqual(events.find((event) => event.type === "command-result"), {
      type: "command-result", key: "test-tool", command, status: "returned", output: "1 test passed",
    });
  } finally {
    replace.mock.restore();
    delete require.cache[filename];
  }
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

test("only interactive writer turns can use elevated permission presets", () => {
  const { codexPermissions, supportsRunPermissions } = require("../desktop/run-permissions.mjs");
  const { claudeArguments } = require("../desktop/engines.cjs");
  const cwd = process.cwd();
  const ask = codexPermissions("ask", cwd, false, false);
  assert.equal(ask.approvalPolicy, "on-request");
  assert.equal(ask.approvalsReviewer, "user");
  assert.equal(ask.sandboxPolicy.networkAccess, false);
  assert.deepEqual(codexPermissions("auto", cwd, false, false), { ...ask, approvalsReviewer: "auto_review" });
  assert.deepEqual(codexPermissions("full", cwd, false, false).sandboxPolicy, { type: "dangerFullAccess" });
  assert.equal(codexPermissions("full", cwd, false, false).approvalPolicy, "never");
  assert.equal(codexPermissions("full", cwd, true, false).sandboxPolicy.type, "readOnly");
  assert.equal(codexPermissions("full", cwd, false, true).sandboxPolicy.type, "workspaceWrite");
  for (const mode of ["parallel-write", "session-team", "auto-team", "team-discussion"]) assert.equal(supportsRunPermissions(mode), false);

  const args = (permissionMode, options) => claudeArguments([], null, { role: "write", interactive: true, permissionMode, ...options });
  const mode = (flags) => flags[flags.indexOf("--permission-mode") + 1];
  assert.equal(mode(args("ask")), "default");
  assert.equal(mode(args("auto")), "auto");
  assert.equal(mode(args("full")), "bypassPermissions");
  assert.equal(args("full").includes("--restricted"), false);
  assert.equal(args("auto").includes("--restricted"), true);
  assert.equal(mode(args("full", { writePaths: ["src"] })), "default");
  assert.equal(mode(args("full", { role: "review" })), "default");
  assert.equal(mode(args("full", { interactive: false })), "acceptEdits");
});
