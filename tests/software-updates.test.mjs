import test from "node:test";
import assert from "node:assert/strict";
import { compareSoftwareVersions as compare, softwareVersion, parseWindowsPackage, createUpdateMonitor, createUpdateReader, updateExecutable } from "../desktop/software-updates.mjs";

test("protected Windows package-manager aliases remain usable without falling back for provider CLIs", () => {
  const alias = "C:/Users/test/AppData/Local/Microsoft/WindowsApps/winget.exe";
  assert.equal(updateExecutable("winget", () => undefined, alias), alias);
  assert.equal(updateExecutable("winget", () => "C:/winget.exe", alias), "C:/winget.exe");
  assert.equal(updateExecutable("codex", () => undefined, alias), undefined);
});

test("invalid old update cache does not prevent app startup", () => {
  for (const saved of [null, [], "invalid"]) {
    const monitor = createUpdateMonitor({ saved, read: async () => [], persist() {} });
    assert.equal(monitor.view().unread, 0); assert.equal(monitor.view().items.length, 4);
  }
});

test("update comparison handles bundled alpha builds, stable channels and MSIX versions without downgrades", () => {
  assert.equal(compare("0.167.1", "codex-cli 0.167.0-alpha.3.2"), 1);
  assert.equal(compare("0.167.1", "0.168.0-alpha.1"), -1);
  assert.equal(compare("2.1.322", "2.1.319 (Claude Code)"), 1);
  assert.equal(compare("5.1231.2.0", "5.1231.2"), 0);
  assert.equal(compare("1.2.3-alpha.10", "1.2.3-alpha.9"), 1);
  assert.equal(compare("1.2.3", "1.2.3-rc.1"), 1);
  for (const value of ["unknown", "0.0.0", "latest", "1.2.3 extra", "1.2.3<script>", null]) assert.equal(softwareVersion(value), null);
});

test("Windows catalog parser requires an exact product and an actual Available version", () => {
  assert.deepEqual(parseWindowsPackage("Name Id Version Available Source\nClaude Anthropic.Claude 5.1.0.0 5.2.0.0 winget", "Anthropic.Claude"), { installed: "5.1.0.0", latest: "5.2.0.0" });
  assert.deepEqual(parseWindowsPackage("\x1b[32mChatGPT 9PLM9XGG6VKS 26.1103.7773.0\x1b[0m", "9PLM9XGG6VKS"), { installed: "26.1103.7773.0", latest: null });
  assert.deepEqual(parseWindowsPackage("Claude Anthropic.Claude 5.1.0 winget", "Anthropic.Claude"), { installed: "5.1.0", latest: null });
  assert.equal(parseWindowsPackage("Other Anthropic.Claude.Beta 5.1.0 5.2.0", "Anthropic.Claude"), null);
  assert.equal(parseWindowsPackage("Terms require agreement", "Anthropic.Claude"), null);
});

test("reader uses metadata only, respects Claude stable and reads local processes serially", async () => {
  const calls = [], urls = []; let active = 0;
  const read = createUpdateReader({ platform: "win32", executable: (name) => "C:/resources/" + name + ".exe", claudeChannel: async () => "stable",
    capture: async (exe, args) => {
      assert.equal(active++, 0); await Promise.resolve(); active--;
      calls.push({ exe, args });
      return { code: 0, stdout: args[0] === "list" ? (args.includes("9PLM9XGG6VKS") ? "ChatGPT 9PLM9XGG6VKS 26.1.0.0" : "Claude Anthropic.Claude 5.1.0.0 5.2.0.0 winget") : exe.includes("codex") ? "codex-cli 0.167.0-alpha.3.2" : "2.1.319 (Claude Code)" };
    }, fetcher: async (url) => { urls.push(url); return new Response(JSON.stringify({ latest: url.includes("openai") ? "0.167.1" : "2.1.322", stable: "2.1.311" })); },
  });
  const result = await read(new AbortController().signal);
  assert.equal(calls.length, 4); assert.equal(urls.length, 2);
  assert.ok(calls.every(({ args }) => args[0] === "list" || args.length === 1 && args[0] === "--version"));
  assert.ok(calls.slice(0, 2).every(({ args }) => args.includes("--disable-interactivity") && !args.some((arg) => /upgrade|accept/.test(arg))));
  assert.deepEqual(result.map(({ status }) => status), ["current", "update", "update", "current"]);
  assert.equal(result[3].channel, "stable"); assert.equal(result[2].bundled, true);
  assert.ok(!JSON.stringify(result).includes("C:/resources"));
});

test("offline and oversized metadata stay unknown and abort stops subsequent checks", async () => {
  const read = createUpdateReader({ executable: (name) => name, platform: "linux", capture: async () => ({ code: 0, stdout: "1.2.3" }), fetcher: async () => new Response("x".repeat(65537)) });
  const offline = await read(new AbortController().signal);
  assert.ok(offline.every((item) => item.status === "unknown"));
  assert.equal(offline.find((item) => item.id === "claude-cli").installed, "1.2.3");
  let calls = 0; const controller = new AbortController();
  const cancel = createUpdateReader({ executable: (name) => name, platform: "win32", capture: async () => { calls++; controller.abort(); return { code: 0, stdout: "" }; } });
  await assert.rejects(cancel(controller.signal), { name: "AbortError" }); assert.equal(calls, 1);
});

test("monitor coalesces checks, persists exact read versions and retries failures without false updates", async () => {
  let now = 1_000_000_000, calls = 0, saved, release;
  const updates = [{ id: "codex-cli", installed: "1.2.3", latest: "1.2.4", status: "update", checkedAt: now }];
  const options = { now: () => now, persist: (value) => { saved = value; } };
  const monitor = createUpdateMonitor({ ...options, read: async () => { calls++; await new Promise((resolve) => { release = resolve; }); return updates; } });
  const first = monitor.check(); const second = monitor.check({ force: true }); assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1); release(); await first;
  assert.equal(monitor.view().unread, 1);
  monitor.markRead({ "codex-cli": "1.2.5" }); assert.equal(monitor.view().unread, 1);
  monitor.markRead({ "codex-cli": "1.2.4" }); assert.equal(monitor.view().unread, 0);
  const restored = createUpdateMonitor({ ...options, saved, read: async () => { calls++; return updates; } });
  assert.equal(restored.view().unread, 0); await restored.check(); assert.equal(calls, 1);
  now += 6 * 3600000 + 1; updates[0] = { ...updates[0], latest: "1.2.5" }; await restored.check(); assert.equal(restored.view().unread, 1);
  const offline = createUpdateMonitor({ ...options, saved, read: async () => [{ id: "codex-cli", status: "unknown" }] });
  await offline.check({ force: true }); assert.equal(offline.view().items.find((item) => item.id === "codex-cli").stale, true);
  const attempts = calls; await offline.check(); assert.equal(calls, attempts);
});

test("monitor yields to foreground work and does not save aborted results", async () => {
  let busy = true, saved = 0, calls = 0;
  const monitor = createUpdateMonitor({ canCheck: () => !busy, persist: () => { saved++; }, read: async (signal) => { calls++; await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))); return []; } });
  await monitor.check({ force: true }); assert.equal(calls, 0);
  busy = false; const pending = monitor.check({ force: true }); await Promise.resolve(); monitor.abort(); await pending;
  assert.equal(saved, 0); assert.equal(monitor.view().checking, false); assert.equal(monitor.view().unread, 0);
});

test("installing a newer binary clears an old update alert even if the catalog is offline", async () => {
  const monitor = createUpdateMonitor({ saved: { items: [{ id: "codex-cli", installed: "1.2.3", latest: "1.2.4", status: "update" }] },
    persist() {}, read: async () => [{ id: "codex-cli", installed: "1.2.4", status: "unknown" }] });
  assert.equal(monitor.view().unread, 1); await monitor.check({ force: true });
  assert.equal(monitor.view().unread, 0);
  assert.equal(monitor.view().items.find((item) => item.id === "codex-cli").installed, "1.2.4");
});

test("failed catalog reads cannot reuse updates from a different Claude release channel", async () => {
  const monitor = createUpdateMonitor({ saved: { items: [{ id: "claude-cli", installed: "2.1.319", latest: "2.1.322", channel: "latest", status: "update", checkedAt: Date.now() }] },
    persist() {}, read: async () => [{ id: "claude-cli", installed: "2.1.319", channel: "stable", status: "unknown", checkedAt: Date.now() }] });
  assert.equal(monitor.view().unread, 1); await monitor.check({ force: true });
  const item = monitor.view().items.find((row) => row.id === "claude-cli");
  assert.equal(item.channel, "stable"); assert.equal(item.status, "unknown"); assert.equal(monitor.view().unread, 0);
});

test("restored desktop versions keep their source type and expired snapshots are marked stale", () => {
  const now = 1_000_000_000;
  const monitor = createUpdateMonitor({ now: () => now, persist() {}, read: async () => [], saved: { items: [
    { id: "claude-app", installed: "5.1.0.0", channel: "latest", status: "current", checkedAt: now - 7 * 3600000 },
    { id: "codex-cli", installed: "0.167.1", status: "current", checkedAt: now - 1000 },
  ] } });
  assert.equal(monitor.view().items[1].channel, undefined);
  assert.equal(monitor.view().items[1].stale, true);
  assert.equal(monitor.view().items[2].stale, false);
});
