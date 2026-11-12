const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Inspect the user's request, never retrieved pages, attachments or teammate text.
function nativeChromeRequested(prompt) {
  if (typeof prompt !== "string") return false;
  if (/(?:ไม่ต้อง|อย่า|ห้าม|do\s+not|don't)[^\n.!?]{0,60}(?:chrome|โครม|edge|เอดจ์)/iu.test(prompt)) return false;
  return /(?:^|\s)(?:\/chrome\b|@chrome\b)/iu.test(prompt) ||
    /(?:chrome|โครม|edge|เอดจ์)/iu.test(prompt) &&
    /(?:\b(?:open|browse|navigate|click|inspect|screenshot|capture|control|check|read|test)\b|เปิด|เข้าเว็บ|คลิก|กด|ตรวจ|เช็ค|เช็ก|อ่าน|จับจอ|จับหน้าจอ|แคป|ควบคุม|ทดสอบ)/iu.test(prompt);
}

const chromePrefix = "mcp__claude-in-chrome__";
const chromeReadTools = new Set(["list_connected_browsers", "tabs_context_mcp", "read_page", "find", "get_page_text", "read_console_messages", "read_network_requests"]);
function nativeChromeTools(status) {
  const server = status?.mcpServers?.find(s => s.name === "claude-in-chrome" && s.status === "connected");
  return (server?.tools ?? []).filter(t => typeof t.name === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(t.name))
    .map(t => chromePrefix + t.name);
}
function nativeChromeDecision(tool, input, active = true) {
  if (!tool?.startsWith(chromePrefix)) return;
  if (!active) return "deny";
  // Full file access does not silently approve changes in a signed-in browser.
  if (JSON.stringify(input ?? {}).length > 12000) return "deny";
  const name = tool.slice(chromePrefix.length);
  return chromeReadTools.has(name) || name === "computer" && input?.action === "screenshot" ? "allow" : "ask";
}

function claudeMemoryPreferences(cwd, { home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), env = process.env } = {}) {
  const prefs = {};
  function read(filename, root) {
    try {
      const actual = fs.realpathSync.native(filename);
      if (root) {
        const relative = path.relative(fs.realpathSync.native(root), actual);
        if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) return {};
      }
      if (fs.statSync(actual).size > 512 * 1024) return {};
      return JSON.parse(fs.readFileSync(actual, "utf8").replace(/^\uFEFF/u, ""));
    } catch { return {}; }
  }
  const user = read(path.join(home, "settings.json"));
  if (typeof user?.autoMemoryEnabled === "boolean") prefs.autoMemoryEnabled = user.autoMemoryEnabled;
  if (typeof user?.autoMemoryDirectory === "string" && user.autoMemoryDirectory.length <= 1024 && path.isAbsolute(user.autoMemoryDirectory)) {
    prefs.autoMemoryDirectory = user.autoMemoryDirectory;
  }
  // Project data can disable memory, but cannot escalate trust or redirect its store.
  if (cwd) for (const filename of ["settings.json", "settings.local.json"]) {
    if (read(path.join(cwd, ".claude", filename), cwd)?.autoMemoryEnabled === false) prefs.autoMemoryEnabled = false;
  }
  if (env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1") prefs.autoMemoryEnabled = false;
  return prefs;
}

module.exports = { nativeChromeRequested, nativeChromeTools, nativeChromeDecision, claudeMemoryPreferences, chromePrefix };
