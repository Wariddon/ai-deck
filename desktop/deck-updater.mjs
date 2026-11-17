import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { latestDeckRelease, downloadDeckRelease } from './deck-release.mjs';
import { compareSoftwareVersions } from './software-updates.mjs';

export function createDeckUpdater({ root, version, idle, pid = process.pid, platform = process.platform, fetcher = fetch,
  capture, started, launch = spawn }) {
  let pending, ready, controller;
  const helper = fileURLToPath(new URL('./deck-update.ps1', import.meta.url));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  function check() {
    if (platform !== 'win32' || path.dirname(root) === root || !fs.existsSync(path.join(root, 'resources', 'app', 'release-manifest.json')) || !fs.existsSync(path.join(root, 'START HERE.txt')) || !fs.existsSync(path.join(root, 'AI Deck.exe')) || !idle()) throw Error('Update AI Deck while its chats are idle, from a portable Windows installation.');
  }
  async function prepare() {
    check(); if (ready) return { token: ready.token, version: ready.version }; if (pending) return pending;
    controller = new AbortController(); const own = controller;
    pending = (async () => {
      const metadata = await latestDeckRelease({ fetcher, signal: own.signal }); check();
      if (compareSoftwareVersions(metadata.version, version) <= 0) throw Error('AI Deck is already up to date.');
      const work = fs.mkdtempSync(path.join(path.dirname(fs.realpathSync.native(root)), '.ai-deck-update-tmp-'));
      // Use a UUID-only directory so the detached helper can verify its exact scope.
      const destination = path.join(path.dirname(work), '.ai-deck-update-' + randomUUID());
      fs.renameSync(work, destination);
      try {
        const archive = await downloadDeckRelease(metadata, destination, { fetcher, signal: own.signal }); check();
        const receipt = path.join(destination, 'receipt.json');
        fs.writeFileSync(receipt, JSON.stringify({ root: fs.realpathSync.native(root), work: destination, archive,
          version: metadata.version, sha256: metadata.sha256, pid, started: await started(pid) }), { flag: 'wx' });
        const script = path.join(destination, 'install.ps1'); fs.copyFileSync(helper, script);
        const result = await capture(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Receipt', receipt],
          { timeout: 60000, limit: 4096, signal: own.signal });
        if (result.code !== 0) throw Error('AI Deck could not verify the downloaded update. Your current installation is unchanged.');
        own.signal.throwIfAborted(); check();
        ready = { token: randomUUID(), version: metadata.version, receipt, script, work: destination };
        return { token: ready.token, version: ready.version };
      } catch (error) {
        // Only this newly created, verified sibling staging directory is removed.
        if (path.dirname(destination) === path.dirname(root) && path.basename(destination).startsWith('.ai-deck-update-')) fs.rmSync(destination, { force: true, recursive: true });
        throw error;
      }
    })().finally(() => { pending = undefined; if (controller === own) controller = undefined; });
    return pending;
  }
  return { prepare, get preparing() { return Boolean(pending); }, apply(token) {
    check(); if (!ready || ready.token !== token) throw Error('Prepare this update again before restarting.');
    const job = launch(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ready.script, '-Receipt', ready.receipt, '-Apply'],
      { detached: true, windowsHide: true, stdio: 'ignore', cwd: ready.work });
    return new Promise((resolve, reject) => { job.once('error', reject); job.once('spawn', () => { job.unref(); ready = undefined; resolve(true); }); });
  }, abort() { controller?.abort(); } };
}
