const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

function stdioClient(exe, args, options = {}) {
  const child = spawn(exe, args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let sequence = 0, closed = false, stopping = false;
  child.stdin.on("error", () => {}); child.stderr.on("data", () => {});
  const fail = () => { closed = true; for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("The semantic tool service stopped.")); } pending.clear(); };
  child.once("error", fail); child.once("exit", fail);
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on("line", (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    message.error ? entry.reject(new Error("The semantic tool service rejected the request.")) : entry.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error("The semantic tool service is closed."));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The semantic tool service timed out.")); }, options.timeout ?? 90000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const close = () => {
    if (stopping) return;
    stopping = true;
    fail(); reader.close(); child.stdin.destroy();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
      else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } }
    }
  };
  options.signal?.addEventListener("abort", close, { once: true });
  return { request, async initialize() {
    await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "AI Deck", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }, close };
}

function remoteClient(url, headers, { signal, fetch: send = fetch } = {}) {
  let sequence = 0, session;
  async function request(method, params, notification = false) {
    const id = notification ? undefined : ++sequence;
    const response = await send(url, { method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
      headers: { ...headers, Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-03-26", ...(session && { "Mcp-Session-Id": session }) },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "GitHub authentication or repository access is unavailable." : "GitHub MCP could not complete the read request.");
    if (notification) { await response.body?.cancel().catch(() => {}); return {}; }
    session = response.headers.get("mcp-session-id") ?? session;
    let body = ""; const reader = response.body.getReader(), decoder = new TextDecoder();
    try { for (;;) {
      const part = await reader.read(); if (part.done) break;
      body += decoder.decode(part.value, { stream: true });
      if (body.length > 200000) throw new Error("GitHub MCP response exceeded the read budget.");
      const events = response.headers.get("content-type")?.includes("text/event-stream")
        ? body.split(/\r?\n\r?\n/u).slice(0, -1).flatMap(frame => frame.split(/\r?\n/u).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim())) : [body];
      for (const event of events) { let message; try { message = JSON.parse(event); } catch { continue; }
        if (message.id !== id) continue;
        if (message.error) throw new Error("GitHub MCP rejected this read operation.");
        return message.result;
      }
    } } finally { await reader.cancel().catch(() => {}); }
    throw new Error("GitHub MCP returned no result.");
  }
  return { request, async initialize() { await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "AI Deck", version: "1" } }); await request("notifications/initialized", {}, true); } };
}
module.exports = { stdioClient, remoteClient };
