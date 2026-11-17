const { execFile } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const { createServer } = require("node:http");
const path = require("node:path");
const { abortableRead } = require("./abortable-read.cjs");

const computerName = "ai_deck_computer";
const controlId = { type: "integer", minimum: 1, maximum: 36, description: "Control ID from the latest inspect result." };
const definitions = [
  ["screenshot", "Get a fresh screenshot of a Windows window shared for this turn. Coordinates are normalized to 0–1000 within this image.", {}, []],
  ["inspect", "List usable accessibility controls in the shared window. Control IDs are replaced on each inspection.", {}, []],
  ["invoke", "Ask the user to approve invoking one control in the shared window.", { controlId }, ["controlId"]],
  ["set_text", "Ask the user to approve replacing the text in an editable control in the shared window.", {
    controlId, text: { type: "string", maxLength: 600, description: "Exact replacement text." },
  }, ["controlId", "text"]],
  ["scroll", "Ask the user to approve scrolling an accessible control from the latest inspect result.", {
    controlId, direction: { type: "string", enum: ["up", "down", "left", "right"] },
  }, ["controlId", "direction"]],
  ["press_key", "Ask the user to approve one navigation key in a focused accessible control. No global or system shortcuts.", {
    controlId, key: { type: "string", enum: ["Enter", "Tab", "Shift+Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"] },
  }, ["controlId", "key"]],
  ["click", "Ask approval for one click at normalized coordinates in the latest screenshot of the shared window.", {
    x: { type: 'integer', minimum: 0, maximum: 1000 }, y: { type: 'integer', minimum: 0, maximum: 1000 },
  }, ['x', 'y']],
  ["drag", "Ask approval for a bounded drag wholly inside the shared window, using normalized coordinates in its latest screenshot.", {
    x: { type: 'integer', minimum: 0, maximum: 1000 }, y: { type: 'integer', minimum: 0, maximum: 1000 },
    toX: { type: 'integer', minimum: 0, maximum: 1000 }, toY: { type: 'integer', minimum: 0, maximum: 1000 },
  }, ['x', 'y', 'toX', 'toY']],
].map(([name, description, properties, required]) => ({
  name, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: required.length === 0, destructiveHint: required.length > 0, openWorldHint: required.length > 0 },
}));
const chromeNavigation = {
  name: "navigate", description: "Ask the user to approve opening an HTTP or HTTPS URL in the current tab of the shared Chrome window.",
  inputSchema: { type: "object", properties: { url: { type: "string", maxLength: 1600 } }, required: ["url"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
};
const chromeDefinitions = [...definitions, chromeNavigation];
const protocols = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const codexToolPrefix = computerName + "_";
const windowList = { name: 'windows', description: 'List only the windows explicitly shared for this turn. Pass windowId when using any tool with several shared windows.',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true } };
const routingDefinitions = tools => [...tools.map(t => ({ ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties,
  windowId: { type: 'string', maxLength: 80, description: 'Window ID returned by windows. Required when several windows were shared.' } } } })), windowList];
const codexDefinitions = (tools) => routingDefinitions(tools).map(({ name, description, inputSchema }) =>
  ({ type: "function", name: codexToolPrefix + name, description, inputSchema }));
const codexWindowTools = codexDefinitions(definitions);
const codexChromeTools = codexDefinitions(chromeDefinitions);
const computerMode = (agent, access) => agent === "codex" ? access === "edit" ? "codex" : "codex-review"
  : access === "edit" ? "claude-write" : "claude";
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function windowHandle(id) {
  const handle = /^window:(\d+):\d+$/u.exec(id)?.[1];
  if (!handle || !Number.isSafeInteger(Number(handle)) || Number(handle) < 1) throw new Error("This window has no supported Windows handle.");
  return handle;
}

function windowsUi(request, signal) {
  if (process.platform !== "win32") throw new Error("Window controls are available on Windows.");
  return new Promise((resolve, reject) => {
    const child = execFile(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "computer-windows.ps1")], { windowsHide: true, timeout: 10000,
      maxBuffer: request.action === "capture" ? 1500 * 1024 : 96 * 1024, signal }, (error, stdout) => {
      if (error) { reject(new Error(signal?.aborted ? "Computer Use stopped." : "Windows did not return control information.")); return; }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) throw new Error(result.error);
        resolve(result);
      } catch (reason) { reject(reason); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

const textResult = (text) => ({ content: [{ type: "text", text }] });

function singleWindowTools({ target, readWindow, approve, report, enabled, ui = windowsUi, now = Date.now }) {
  const toolDefinitions = target.chrome ? chromeDefinitions : definitions;
  const abort = new AbortController();
  let controls = [];
  let inspectedView;
  let inspectedAt = 0;
  let frame;
  let working = false;
  let attempts = 0;
  const ensureActive = () => {
    if (abort.signal.aborted || !enabled()) throw new Error("Window access has ended.");
  };
  const query = (action, extra) => ui({ action, handle: target.handle, identity: target.identity, ...extra }, abort.signal);
  const decision = (action) => abortableRead(() => approve(action), abort.signal);
  const freshControls = () => {
    if (!controls.length || now() - inspectedAt > 30000) {
      controls = [];
      throw new Error("Inspect the window again; its control observation has expired.");
    }
  };
  const viewOf = (result) => {
    if (!target.chrome) return undefined;
    if (!result.view) throw new Error("Chrome could not identify the active tab. Wait for it to load and inspect it again.");
    return result.view;
  };

  async function call(name, args) {
    ensureActive();
    const tool = toolDefinitions.find((entry) => entry.name === name);
    const validArgs = args && typeof args === "object" && !Array.isArray(args) &&
      Object.keys(args).length === tool?.inputSchema.required.length && tool.inputSchema.required.every((key) => Object.hasOwn(args, key));
    if (!validArgs) throw new Error("Invalid Computer Use tool or parameters.");
    if (working || attempts >= 20) throw new Error("Computer Use is busy or reached this turn's action limit.");
    working = true;
    attempts++;
    try {
      const { title = target.title } = await readWindow(false) ?? {};
      ensureActive();
      if (name === "inspect") {
        controls = [];
        const inspected = await query("inspect");
        inspectedView = viewOf(inspected);
        if (!Array.isArray(inspected.controls) || inspected.controls.length > 36) throw new Error("Windows returned invalid controls.");
        controls = inspected.controls;
        inspectedAt = now();
        ensureActive();
        report("Inspected controls in " + title);
        return textResult(JSON.stringify({ window: title, controls: controls.map(({ key, ...control }, index) => ({ id: index + 1, ...control })) }));
      }
      if (name === "screenshot") {
        const identified = await query("identify"), view = viewOf(identified);
        const image = await readWindow(true);
        await query("identify", { view });
        ensureActive();
        frame = { view, geometry: identified.geometry, at: now(), sha256: createHash('sha256').update(image).digest('hex') };
        report("Captured " + title);
        return { content: [{ type: "image", mimeType: "image/jpeg", data: image.toString("base64") }] };
      }
      if (name === 'click' || name === 'drag') {
        const fields = name === 'drag' ? ['x', 'y', 'toX', 'toY'] : ['x', 'y'];
        if (!fields.every(k => Number.isInteger(args[k]) && args[k] >= 0 && args[k] <= 1000)) throw Error('Use screenshot coordinates from 0 to 1000.');
        const fresh = () => { if (!frame?.geometry || now() - frame.at > 30000) throw Error('Capture a fresh screenshot before using coordinates.'); };
        fresh(); const observed = frame;
        const summary = name === 'drag' ? `Drag (${args.x}, ${args.y}) to (${args.toX}, ${args.toY})` : `Click (${args.x}, ${args.y})`;
        if (!await decision({ summary, window: title })) return { ...textResult('The user did not approve this action.'), isError: true };
        ensureActive(); fresh();
        const currentImage = await readWindow(true); ensureActive(); fresh();
        if (createHash('sha256').update(currentImage).digest('hex') !== observed.sha256) { frame = undefined; throw Error('The window image changed after approval. Capture it again.'); }
        frame = undefined; controls = [];
        await query(name, { ...args, geometry: observed.geometry, view: observed.view });
        report(summary + ' · completed in ' + title);
        return textResult('Action completed. Capture a fresh screenshot before another coordinate action.');
      }
      if (name === "navigate") {
        frame = undefined;
        let url;
        if (typeof args.url === "string" && args.url.length <= 1600) {
          try { url = new URL(args.url); } catch {}
        }
        if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Choose an HTTP or HTTPS URL without credentials.");
        const view = viewOf(await query("identify"));
        ensureActive();
        const summary = "Open " + url.href;
        if (!await decision({ summary, window: title })) return { ...textResult("The user did not approve this action."), isError: true };
        ensureActive();
        await readWindow(false);
        ensureActive();
        controls = [];
        await query("navigate", { url: url.href, view });
        report("Opened " + url.origin + " in the shared Chrome window");
        return textResult("Chrome received the navigation. Inspect the new page before taking another action.");
      }
      frame = undefined;
      const control = Number.isSafeInteger(args.controlId) && controls[args.controlId - 1];
      if (control) freshControls();
      const set = name === "set_text";
      if (name === "scroll" || name === "press_key") {
        const scrolling = name === "scroll";
        const allowed = scrolling ? ["up", "down", "left", "right"]
          : ["Enter", "Tab", "Shift+Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
        const value = scrolling ? args.direction : args.key;
        if (!control || !(scrolling ? control.scroll : control.keyInput) || !allowed.includes(value)) throw new Error("Inspect and choose a control that supports this navigation.");
        const summary = (scrolling ? "Scroll " + value : "Press " + value) + " in “" + control.label + "”";
        const view = inspectedView;
        if (!await decision({ summary, window: title })) return { ...textResult("The user did not approve this action."), isError: true };
        ensureActive(); await readWindow(false); ensureActive(); freshControls(); controls = [];
        await query(scrolling ? "scroll" : "press_key", { key: control.key, view, ...(scrolling ? { direction: value } : { keyName: value }) });
        report(summary + " · completed in " + title);
        return textResult("Navigation completed. Inspect or capture the window again before the next action.");
      }
      if (!control || (set ? !control.set : !control.invoke)) throw new Error("Inspect the window and choose a control that supports this action.");
      if (set && (typeof args.text !== "string" || args.text.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(args.text))) {
        throw new Error("Replacement text must contain up to 600 printable characters.");
      }
      const action = set ? "Replace text in" : "Invoke";
      const summary = action + " “" + control.label + "”";
      const accepted = await decision({ summary, label: control.label, text: set ? args.text : undefined, window: title });
      if (!accepted) return { ...textResult("The user did not approve this action."), isError: true };
      ensureActive();
      await readWindow(false);
      ensureActive();
      freshControls();
      controls = [];
      await query(set ? "set" : "invoke", { key: control.key, view: inspectedView, ...(set && { text: args.text }) });
      report(summary + " · completed in " + title);
      return textResult(summary + " succeeded. Inspect the window again before the next action.");
    } finally { working = false; }
  }
  return { call, definitions: toolDefinitions, close: () => abort.abort(new Error("Window access has ended.")) };
}

function createWindowTools(options) {
  const targets = options.target.windows ?? [options.target];
  if (!targets.length || targets.length > 3 || new Set(targets.map(t => t.id)).size !== targets.length) throw Error('Share one to three distinct windows.');
  const members = targets.map(target => ({ target, tools: singleWindowTools({ ...options, target,
    readWindow: image => options.readWindow(image, target) }) }));
  let working = false, attempts = 0, closed = false;
  return { definitions: routingDefinitions(options.target.chrome ? chromeDefinitions : definitions), async call(name, args = {}) {
    if (closed || !options.enabled()) throw Error('Window access has ended.');
    if (working || attempts >= 20) throw Error('Computer Use is busy or reached this turn\'s action limit.');
    attempts++;
    if (name === 'windows') {
      if (Object.keys(args).length) throw Error('Invalid windows arguments.');
      return textResult(JSON.stringify(members.map(({ target }) => ({ windowId: target.id, title: target.title }))));
    }
    const { windowId, ...parameters } = args;
    const member = windowId === undefined && members.length === 1 ? members[0] : members.find(m => m.target.id === windowId);
    if (!member) throw Error('Choose a windowId from the shared windows list.');
    working = true;
    try { return await member.tools.call(name, parameters); } finally { working = false; }
  }, close() { closed = true; for (const { tools } of members) tools.close(); } };
}

async function startComputerServer(tools) {
  const toolDefinitions = tools.definitions ?? definitions;
  const route = "/" + randomUUID();
  const server = createServer(async (request, response) => {
    if (request.headers.origin || request.url !== route) { response.writeHead(404).end(); return; }
    if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }).end(); return; }
    let body = "";
    try {
      request.setEncoding("utf8");
      for await (const part of request) {
        body += part;
        if (body.length > 32000) { response.writeHead(413).end(); return; }
      }
      const { jsonrpc, id, method, params } = JSON.parse(body);
      if (jsonrpc !== "2.0" || typeof method !== "string") { response.writeHead(400).end(); return; }
      if (id === undefined) { response.writeHead(202).end(); return; }
      let result;
      if (method === "initialize") {
        result = { protocolVersion: protocols.has(params?.protocolVersion) ? params.protocolVersion : "2025-03-26",
          serverInfo: tools.serverInfo ?? { name: "AI Deck Computer Use", version: "1" }, capabilities: { tools: {} } };
      } else if (method === "ping") result = {};
      else if (method === "tools/list") result = { tools: toolDefinitions };
      else if (method === "tools/call") {
        try { result = await tools.call(params?.name, params?.arguments ?? {}); }
        catch (error) { result = { ...textResult(error.message || "Window action failed."), isError: true }; }
      }
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(JSON.stringify({ jsonrpc: "2.0", id, ...(result ? { result } : { error: { code: -32601, message: "Unsupported MCP method" } }) }));
    } catch { if (!response.headersSent) response.writeHead(400).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    plugin: { name: tools.name ?? computerName, url: "http://127.0.0.1:" + server.address().port + route, tools: toolDefinitions.map(({ name }) => name),
      ...(tools.readTools && { readTools: tools.readTools, builtIn: true }) },
    close() { tools.close(); server.close(); server.closeAllConnections(); },
  };
}

async function callCodexWindowTool(tools, name, args) {
  if (typeof name !== "string" || !name.startsWith(codexToolPrefix)) throw new Error("Unknown window tool.");
  const result = await tools.call(name.slice(codexToolPrefix.length), args ?? {});
  return {
    success: !result.isError,
    contentItems: result.content.map((item) => item.type === "image"
      ? { type: "inputImage", imageUrl: "data:" + item.mimeType + ";base64," + item.data }
      : { type: "inputText", text: item.text }),
  };
}

module.exports = { computerName, computerMode, windowHandle, windowsUi, createWindowTools, startComputerServer, codexWindowTools, codexChromeTools, callCodexWindowTool };
