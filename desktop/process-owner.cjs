const processes = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Only handles created here are eligible. Never scan/kill providers by name.
const owners = new WeakMap();
function spawnOwned(exe, args, options = {}) {
  const { signal, reapOnExit = false, ...settings } = options;
  signal?.throwIfAborted();
  const began = new Date().toISOString();
  const child = processes.spawn(exe, args, { ...settings, detached: process.platform !== 'win32' });
  const owner = { alive: true, began, reapOnExit };
  owners.set(child, owner);
  child.once('exit', () => {
    owner.alive = false; owner.ended = new Date().toISOString();
    if (reapOnExit) void stopChild(child);
  });
  const abort = () => {
    const error = new Error('The operation was aborted', { cause: signal.reason });
    error.name = 'AbortError'; error.code = 'ABORT_ERR';
    child.emit('error', error);
    void stopChild(child);
  };
  signal?.addEventListener('abort', abort, { once: true });
  child.once('close', () => { owner.alive = false; signal?.removeEventListener('abort', abort); });
  return child;
}

function stopChild(child) {
  if (!child) return Promise.resolve();
  const owner = owners.get(child);
  if (!owner) return Promise.resolve();
  if (owner.stopping) return owner.stopping;
  const exited = !owner.alive || child.exitCode != null || child.signalCode != null;
  if (exited && !(owner.reapOnExit && owner.ended && process.platform === 'win32' && Number.isInteger(child.pid))) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers();
  owner.stopping = promise;
  if (exited) {
    try {
      processes.execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', fs.readFileSync(path.join(__dirname, 'reap-owned-children.ps1'), 'utf8')],
        { windowsHide: true, timeout: 4000, env: { ...process.env, AI_DECK_EXITED_OWNER_PID: String(child.pid), AI_DECK_OWNER_BEGAN_UTC: owner.began, AI_DECK_OWNER_ENDED_UTC: owner.ended } }, () => resolve());
    } catch { resolve(); }
    return promise;
  }
  const fallback = () => { if (owner.alive) { try { child.kill(); } catch {} } resolve(); };
  if (!Number.isInteger(child.pid) || child.pid <= 0) { fallback(); return promise; }
  if (process.platform === 'win32') {
    // Kill the tree while its root still exists; killing the root first loses
    // Windows' parent/child relationship and can strand shell/MCP helpers.
    processes.execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 }, error => {
        if (error) fallback(); else resolve();
      });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); resolve(); } catch { fallback(); }
  }
  return promise;
}

module.exports = { spawnOwned, stopChild };
