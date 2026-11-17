import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = v => "'" + v.replaceAll("'", "''") + "'";
test('Windows pointer helper compiles and uses the correct native INPUT ABI without sending input', { skip: process.platform !== 'win32' }, () => {
  const script = fs.readFileSync('desktop/computer-windows.ps1', 'utf8');
  const blocks = [...script.matchAll(/@'\r?\n([\s\S]*?)\r?\n'@/gu)].map(m => m[1]);
  const source = blocks.find(b => b.includes('class DeckPointer'));
  assert.ok(source);
  const result = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -TypeDefinition ' + quote(source) + '; [Runtime.InteropServices.Marshal]::SizeOf([type][DeckPointer+Input])'], { encoding: 'utf8', windowsHide: true });
  assert.equal(Number(result.trim()), process.arch === 'x64' ? 40 : 28);
});
test('Windows updater validates all archive paths and payload hashes before replacement', { skip: process.platform !== 'win32', timeout: 25000 }, () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-update-'));
  try {
    for (const bad of [undefined, 'AI Deck/../../escape.txt', 'AI Deck/resources/app/package.json:stream', 'AI Deck/CON.txt', 'AI Deck/resources/app/unexpected.txt']) {
      const work = path.join(top, '.ai-deck-update-' + randomUUID()); fs.mkdirSync(work);
      const pkg = JSON.stringify({ version: '0.9.182' }), entries = [
        { name: 'AI Deck/AI Deck.exe', text: 'fixture, never executed' },
        { name: 'AI Deck/resources/app/package.json', text: pkg },
        { name: 'AI Deck/resources/app/release-manifest.json', text: JSON.stringify({ schema: 1, version: '0.9.182', files: [{ path: 'package.json', bytes: Buffer.byteLength(pkg), sha256: createHash('sha256').update(pkg).digest('hex') }] }) },
        ...(bad ? [{ name: bad, text: 'bad' }] : []) ];
      const data = path.join(work, 'entries.json'); fs.writeFileSync(data, JSON.stringify(entries));
      const zip = path.join(work, 'release.zip');
      execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open(${quote(zip)},[IO.Compression.ZipArchiveMode]::Create); try { foreach($e in (Get-Content -LiteralPath ${quote(data)} -Raw | ConvertFrom-Json)) { $entry=$z.CreateEntry($e.name); $s=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false)); try {$s.Write($e.text)} finally {$s.Dispose()} } } finally {$z.Dispose()}`], { windowsHide: true, stdio: 'pipe' });
      const receipt = path.join(work, 'receipt.json');
      fs.writeFileSync(receipt, JSON.stringify({ root: path.join(top, 'install'), work, archive: zip, version: '0.9.182', sha256: createHash('sha256').update(fs.readFileSync(zip)).digest('hex') }));
      const run = () => execFileSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('desktop/deck-update.ps1'), '-Receipt', receipt], { windowsHide: true, stdio: 'pipe' }).toString();
      if (bad) assert.throws(run); else assert.equal(JSON.parse(run()).ready, true);
      assert.equal(fs.existsSync(path.join(top, 'escape.txt')), false);
      assert.equal(fs.existsSync(path.join(top, 'install')), false);
    }
  } finally { fs.rmSync(top, { force: true, recursive: true }); }
});
