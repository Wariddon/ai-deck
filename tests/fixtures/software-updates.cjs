// Isolated renderer/preload/main integration. No network, credentials or model requests.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict");
const { app, ipcMain, shell } = require("electron"), { setTimeout: delay } = require("node:timers/promises");
const root = process.env.AI_DECK_QA_ROOT, appDir = process.env.AI_DECK_QA_APP, main = path.join(appDir, "main.cjs");
const restoring = process.env.AI_DECK_QA_RESTORE === "1";
const profile = process.env.AI_DECK_PROFILE_DIRECTORY = path.join(root, "profile");
fs.mkdirSync(profile, { recursive: true });
if (!restoring) fs.writeFileSync(path.join(profile, "workspace-state.json"), JSON.stringify({ workspaces: {}, executables: {}, lowMemory: false, closeToTray: false, preferences: { notifications: "off" } }));
const result = { restoring, checks: [], version: require(path.join(appDir, "package.json")).version, calls: 0, opened: [] };
global.fixtureUpdateRead = async () => {
  result.calls++; await delay(180);
  return [
    { id: "codex-app", installed: "26.1.0.0", latest: "26.2.0.0", status: "update", checkedAt: Date.now() },
    { id: "claude-app", installed: "5.1.0.0", latest: null, status: "current", checkedAt: Date.now() },
    { id: "codex-cli", installed: "0.167.0-alpha.3.2", latest: "0.167.1", bundled: true, status: "update", checkedAt: Date.now() },
    { id: "claude-cli", installed: "2.1.319", latest: "2.1.322", channel: "latest", status: "update", checkedAt: Date.now() },
  ];
};
shell.openExternal = async (url) => { result.opened.push(url); };
const engines = require(path.join(appDir, "engines.cjs"));
engines.capture = async () => ({ code: 1, stdout: "", stderr: "No provider fixture" });
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (key, fn) => handle(key, async (...args) => key === "deck:quota-summary" ? null : fn(...args));
const save = () => fs.writeFileSync(path.join(root, restoring ? "restored.json" : "result.json"), JSON.stringify(result, null, 2));
process.on("uncaughtException", (error) => { result.error = error.stack; save(); app.exit(1); });
app.disableHardwareAcceleration();
app.once("browser-window-created", (_, win) => win.webContents.once("did-finish-load", async () => {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const api = (name, payload) => js("window.aiDeck[" + JSON.stringify(name) + "](" + (JSON.stringify(payload) ?? "") + ")");
  const wait = async (fn, label) => { for (let i = 0; i < 250; i++) { if (await fn()) return; await delay(50); } throw Error("Timeout: " + label); };
  const click = (selector) => js("(()=>{const e=document.querySelector(" + JSON.stringify(selector) + ");if(!e||e.disabled)return false;e.click();return true;})()");
  try {
    await wait(() => js('!!document.querySelector("header.thread-top")&&!document.querySelector(".deck-startup")'), "startup");
    if (restoring) {
      assert.equal((await api("software-updates")).unread, 0);
      assert.equal(await js('document.querySelector(".deck-update-count")?.textContent??""'), "");
      assert.equal(result.calls, 0, "Cached metadata should survive restart without extra requests");
      result.checks.push("Read status and metadata survive full app restart");
    } else {
      await api("software-updates", { check: true, force: true });
      await wait(() => js('document.querySelector(".deck-update-count")?.textContent==="3"'), "unread badge");
      assert.ok(await click(".deck-update-bell"));
      await wait(() => js('document.querySelector(".deck-update-panel").matches(":popover-open")'), "panel");
      assert.equal(await js('document.querySelectorAll(".deck-update-item").length'), 4);
      for (const [width, height] of [[1240, 800], [760, 540]]) {
        win.setSize(width, height); await delay(140);
        if (!await js('document.querySelector(".deck-update-panel").matches(":popover-open")')) await click(".deck-update-bell");
        const rect = await js('(()=>{const p=document.querySelector(".deck-update-panel"),r=p.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth>innerWidth+1};})()');
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= rect.width + 1 && rect.bottom <= rect.height + 1 && !rect.scroll, JSON.stringify(rect));
      }
      fs.writeFileSync(path.join(root, "bell.png"), (await win.webContents.capturePage()).toPNG());
      result.checks.push("Bell badge and bounded panel at normal and compact layouts");
      await js('[...document.querySelectorAll(".deck-update-item")][2].querySelector("button").click()');
      await wait(() => result.opened.length === 1, "open update");
      assert.equal(result.opened[0], "ms-windows-store://pdp/?ProductId=9PLM9XGG6VKS");
      assert.equal((await api("software-updates")).unread, 2);
      await assert.rejects(api("open-software-update", "https://untrusted.invalid"), /supported app/);
      result.checks.push("Bundled Codex opens only the fixed Store page; arbitrary targets are rejected");
      await js('[...document.querySelectorAll(".deck-update-panel button")].find(e=>e.textContent.includes("Mark read")).click()');
      await wait(async () => (await api("software-updates")).unread === 0, "mark read");
      assert.ok(await js('document.querySelector(".deck-update-panel").matches(":popover-open")'));
      await api("software-updates", { check: true, force: true });
      assert.equal((await api("software-updates")).unread, 0);
      assert.equal(result.calls, 2);
      result.checks.push("Reading updates keeps the panel open and refreshing the same release does not notify again");
    }
    assert.equal((await api("state")).jobs.length, 0);
    result.passed = true;
  } catch (error) { result.error = error.stack; result.text = await js("document.body.innerText.slice(-2000)").catch(() => ""); }
  finally { save(); app.quit(); }
}));
const code = fs.readFileSync(main, "utf8")
  .replace('read: createUpdateReader({ capture,', 'read: global.fixtureUpdateRead, unusedReader: createUpdateReader({ capture,')
  .replace('width: 1240, height: 800', 'show: false, width: 1240, height: 800')
  .replace('preload: path.join(__dirname, "preload.cjs"), contextIsolation', 'offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation');
const boot = new Module(main, module); boot.filename = main; boot.paths = Module._nodeModulePaths(appDir); boot._compile(code, main);
