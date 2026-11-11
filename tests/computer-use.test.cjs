const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createWindowTools, startComputerServer, windowHandle, codexWindowTools, callCodexWindowTool } = require("../desktop/computer-use.cjs");

test("shared-window scrolling and navigation keys require fresh controls and approval", async () => {
  const actions = []; let approved = false;
  const tools = createWindowTools({ target: { handle: "12", identity: "34/56", title: "Fixture" }, enabled: () => true,
    readWindow: async () => ({ title: "Fixture" }), approve: async () => approved, report() {},
    ui: async request => { if (request.action === "inspect") return { controls: [{ key: "list", label: "Results", scroll: true, keyInput: true }] };
      actions.push(request); return {}; } });
  try {
    await assert.rejects(tools.call("scroll", { controlId: 1, direction: "down" }), /Inspect/);
    await tools.call("inspect", {});
    assert.equal((await tools.call("scroll", { controlId: 1, direction: "down" })).isError, true);
    assert.equal(actions.length, 0); approved = true;
    await assert.rejects(tools.call("press_key", { controlId: 1, key: "Alt+F4" }), /Inspect/);
    await tools.call("scroll", { controlId: 1, direction: "down" });
    assert.equal(actions[0].action, "scroll"); assert.equal(actions[0].direction, "down");
    await assert.rejects(tools.call("press_key", { controlId: 1, key: "Enter" }), /Inspect/);
    await tools.call("inspect", {}); await tools.call("press_key", { controlId: 1, key: "Tab" });
    assert.equal(actions[1].keyName, "Tab"); assert.equal(actions[1].identity, "34/56");
  } finally { tools.close(); }
});

test("Chrome navigation rejects unsafe URLs and aborts after switching between tabs with the same title", async () => {
  const title = "Same page title";
  let view = "first-tab";
  let switchTab = true;
  const calls = [];
  const tools = createWindowTools({
    target: { handle: "12", identity: "34/56", title, chrome: true },
    enabled: () => true,
    readWindow: async () => ({ title }),
    approve: async () => {
      if (switchTab) view = "second-tab";
      return true;
    },
    report: () => {},
    ui: async (request) => {
      if (request.view && request.view !== view) throw new Error("The selected Chrome tab or page changed.");
      calls.push(request);
      return { controls: [], view };
    },
  });
  try {
    await assert.rejects(tools.call("navigate", { url: "file:///C:/test" }), /HTTP or HTTPS/u);
    await assert.rejects(tools.call("navigate", { url: "https://user:pass@example.com" }), /without credentials/u);
    await assert.rejects(tools.call("navigate", { url: "https://example.com" }), /tab or page changed/u);
    assert.deepEqual(calls.map(({ action }) => action), ["identify"]);
    switchTab = false;
    await tools.call("navigate", { url: "https://example.com" });
    await tools.call("inspect", {});
    assert.deepEqual(calls.map(({ action, view, url }) => [action, view, url]),
      [["identify", undefined, undefined], ["identify", undefined, undefined], ["navigate", "second-tab", "https://example.com/"], ["inspect", undefined, undefined]]);
  } finally { tools.close(); }
});

test("the selected window tools require a fresh control and approval for each change", async () => {
  const actions = [];
  const pending = [];
  const controller = createWindowTools({
    target: { handle: "12", identity: "34/56", title: "Fixture window" },
    enabled: () => true,
    readWindow: async () => Buffer.from("fixture image"),
    approve: (details) => new Promise((resolve) => pending.push({ details, resolve })),
    report: () => {},
    ui: async ({ action, handle, identity, text }) => {
      assert.equal(handle, "12");
      assert.equal(identity, "34/56");
      if (action === "inspect") return { controls: [{ key: "fixture-key", label: "Input", kind: "Edit", set: true }] };
      if (action === "set") actions.push(text);
      return {};
    },
  });
  await assert.rejects(controller.call("set_text", { controlId: 1, text: "ไทย" }), /Inspect the window/);
  await controller.call("inspect", {});
  const first = controller.call("set_text", { controlId: 1, text: "ไทย" });
  await new Promise(setImmediate);
  assert.deepEqual(actions, []);
  assert.equal(pending[0].details.text, "ไทย");
  pending[0].resolve(false);
  assert.equal((await first).isError, true);
  assert.deepEqual(actions, []);
  const second = controller.call("set_text", { controlId: 1, text: "ไทย" });
  await new Promise(setImmediate);
  pending[1].resolve(true);
  await second;
  assert.deepEqual(actions, ["ไทย"]);
  await assert.rejects(controller.call("set_text", { controlId: 1, text: "old control" }), /Inspect the window/);
  const third = controller.call("screenshot", {});
  assert.equal((await third).content[0].mimeType, "image/jpeg");
  controller.close();
  await assert.rejects(controller.call("inspect", {}), /access has ended/);
  assert.equal(windowHandle("window:1234:0"), "1234");
  assert.throws(() => windowHandle("screen:0:0"), /Windows handle/);
});

test("the computer MCP endpoint is scoped to a private route and rejects browser origins", async () => {
  const calls = [];
  const server = await startComputerServer({
    close() {},
    call(name, args) { calls.push({ name, args }); return { content: [{ type: "text", text: "ok" }] }; },
  });
  const endpoint = server.plugin.url;
  const post = (method, params, headers = {}, url = endpoint) => fetch(url, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  try {
    const init = await (await post("initialize", { protocolVersion: "2025-06-18" })).json();
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.deepEqual((await (await post("tools/list")).json()).result.tools.map(tool => tool.name),
      ["screenshot", "inspect", "invoke", "set_text", "scroll", "press_key"]);
    assert.equal((await post("tools/call", { name: "invoke" }, { origin: "http://example.org" })).status, 404);
    assert.equal((await post("tools/call", { name: "invoke" }, {}, new URL("/wrong", endpoint))).status, 404);
    const result = await (await post("tools/call", { name: "set_text", arguments: { controlId: 1, text: "ไทย" } })).json();
    assert.equal(result.result.content[0].text, "ok");
    assert.deepEqual(calls, [{ name: "set_text", args: { controlId: 1, text: "ไทย" } }]);
  } finally { server.close(); }
});

test("Codex window tools map bounded image results to app-server dynamic tool content", async () => {
  const screenshot = codexWindowTools.find(({ name }) => name.endsWith("_screenshot"));
  const tools = { async call(name, args) {
    assert.equal(name, "screenshot");
    assert.deepEqual(args, {});
    return { content: [{ type: "image", mimeType: "image/jpeg", data: "cWEtZml4dHVyZQ==" }] };
  } };
  assert.deepEqual(await callCodexWindowTool(tools, screenshot.name, {}), {
    success: true, contentItems: [{ type: "inputImage", imageUrl: "data:image/jpeg;base64,cWEtZml4dHVyZQ==" }],
  });
  await assert.rejects(callCodexWindowTool(tools, "other_tool", {}), /Unknown window tool/u);
});
