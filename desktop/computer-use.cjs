const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const path = require("node:path");

const computerName = "ai_deck_computer";
const controlId = { type: "integer", minimum: 1, maximum: 36, description: "Control ID from the latest inspect result." };
const definitions = [
  ["screenshot", "Get a screenshot of the one Windows window shared for this turn.", {}, []],
  ["inspect", "List usable accessibility controls in the shared window. Control IDs are replaced on each inspection.", {}, []],
  ["invoke", "Ask the user to approve invoking one control in the shared window.", { controlId }, ["controlId"]],
  ["set_text", "Ask the user to approve replacing the text in an editable control in the shared window.", {
    controlId, text: { type: "string", maxLength: 600, description: "Exact replacement text." },
  }, ["controlId", "text"]],
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
const codexDefinitions = (tools) => tools.map(({ name, description, inputSchema }) =>
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

function createWindowTools({ target, readWindow, approve, report, enabled, ui = windowsUi }) {
  const toolDefinitions = target.chrome ? chromeDefinitions : definitions;
  const abort = new AbortController();
  let controls = [];
  let inspectedView;
  let working = false;
  let attempts = 0;
  const ensureActive = () => {
    if (abort.signal.aborted || !enabled()) throw new Error("Window access has ended.");
  };
  const query = (action, extra) => ui({ action, handle: target.handle, identity: target.identity, ...extra }, abort.signal);
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
        controls = inspected.controls;
        ensureActive();
        report("Inspected controls in " + title);
        return textResult(JSON.stringify({ window: title, controls: controls.map(({ key, ...control }, index) => ({ id: index + 1, ...control })) }));
      }
      if (name === "screenshot") {
        const view = viewOf(await query("identify"));
        const image = await readWindow(true);
        await query("identify", { view });
        ensureActive();
        report("Captured " + title);
        return { content: [{ type: "image", mimeType: "image/jpeg", data: image.toString("base64") }] };
      }
      if (name === "navigate") {
        let url;
        if (typeof args.url === "string" && args.url.length <= 1600) {
          try { url = new URL(args.url); } catch {}
        }
        if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Choose an HTTP or HTTPS URL without credentials.");
        const view = viewOf(await query("identify"));
        ensureActive();
        const summary = "Open " + url.href;
        if (!await approve({ summary, window: title })) return { ...textResult("The user did not approve this action."), isError: true };
        ensureActive();
        await readWindow(false);
        ensureActive();
        controls = [];
        await query("navigate", { url: url.href, view });
        report("Opened " + url.origin + " in the shared Chrome window");
        return textResult("Chrome received the navigation. Inspect the new page before taking another action.");
      }
      const control = Number.isSafeInteger(args.controlId) && controls[args.controlId - 1];
      const set = name === "set_text";
      if (!control || (set ? !control.set : !control.invoke)) throw new Error("Inspect the window and choose a control that supports this action.");
      if (set && (typeof args.text !== "string" || args.text.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(args.text))) {
        throw new Error("Replacement text must contain up to 600 printable characters.");
      }
      const action = set ? "Replace text in" : "Invoke";
      const summary = action + " “" + control.label + "”";
      const decision = await approve({ summary, label: control.label, text: set ? args.text : undefined, window: title });
      if (!decision) return { ...textResult("The user did not approve this action."), isError: true };
      ensureActive();
      await readWindow(false);
      ensureActive();
      controls = [];
      await query(set ? "set" : "invoke", { key: control.key, view: inspectedView, ...(set && { text: args.text }) });
      report(summary + " · completed in " + title);
      return textResult(summary + " succeeded. Inspect the window again before the next action.");
    } finally { working = false; }
  }
  return { call, definitions: toolDefinitions, close: () => abort.abort() };
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
          serverInfo: { name: "AI Deck Computer Use", version: "1" }, capabilities: { tools: {} } };
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
    plugin: { name: computerName, url: "http://127.0.0.1:" + server.address().port + route, tools: toolDefinitions.map(({ name }) => name) },
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
