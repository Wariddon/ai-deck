const fs = require("node:fs");
const path = require("node:path");
const { spawnOwned: spawn, stopChild } = require('./process-owner.cjs');

const serenaPin = "6e5c3776d4e67befaab7c290bc29b0279c98d1ed";
const uvVersion = '0.13.9';
const installs = new Map();
function command(exe, args, { cwd, input, env, signal, timeout = 120000, limit = 24000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "", expired = false;
    const child = spawn(exe, args, { cwd, env, signal, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { expired = true; void stopChild(child); }, timeout);
    child.stdout.on("data", (part) => { stdout = (stdout + part).slice(0, limit); });
    child.stderr.on("data", (part) => { stderr = (stderr + part).slice(-1000); });
    child.stdin.on("error", () => {}); child.stdin.end(input);
    child.once("error", async (error) => { clearTimeout(timer); await stopChild(child); reject(error); });
    child.once("close", async (code) => { clearTimeout(timer); await stopChild(child); code === 0 && !expired ? resolve(stdout) : reject(new Error(expired ? "Tool service timed out." : "Tool service exited unsuccessfully.")); });
  });
}

async function serenaPython(root, { signal, allowInstall = true, report = () => {} } = {}) {
  const override = process.env.AI_DECK_SERENA_PYTHON;
  if (override && path.isAbsolute(override) && fs.existsSync(override)) return override;
  const folder = path.join(root, "serena-" + serenaPin.slice(0, 8));
  const python = path.join(folder, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const marker = path.join(folder, "ai-deck-runtime.json");
  const uv = path.join(path.dirname(python), process.platform === 'win32' ? 'uv.exe' : 'uv');
  const uvx = path.join(path.dirname(python), process.platform === 'win32' ? 'uvx.exe' : 'uvx');
  let installed = false;
  try { installed = JSON.parse(fs.readFileSync(marker, 'utf8')).pin === serenaPin && fs.existsSync(python); } catch {}
  if (installed && fs.existsSync(uv) && fs.existsSync(uvx)) return python;
  if (!allowInstall) throw new Error(installed ? "Serena's uv/uvx dependency is unavailable. Local code search remains available." : "Serena is not installed. The local JS/TS graph is available instead.");
  if (!installs.has(folder)) installs.set(folder, (async () => {
    report("Preparing Serena for semantic code search · first use");
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(python)) await command(process.platform === "win32" ? "python" : "python3", ["-m", "venv", folder], { signal });
    if (!installed) await command(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-compile",
      "https://github.com/oraios/serena/archive/" + serenaPin + ".zip"], { signal, timeout: 240000 });
    if (!fs.existsSync(uv) || !fs.existsSync(uvx)) await command(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--only-binary=:all:', '--timeout', '15', '--retries', '1', 'uv==' + uvVersion], { signal, timeout: 90000 });
    await command(python, ["-c", "from serena.cli import top_level; top_level()", "--version"], { signal, timeout: 30000 });
    fs.writeFileSync(marker, JSON.stringify({ pin: serenaPin, uvVersion }));
    return python;
  })().finally(() => installs.delete(folder)));
  return installs.get(folder);
}
module.exports = { command, serenaPython, serenaPin, uvVersion };
