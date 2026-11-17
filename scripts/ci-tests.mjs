import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';

export function selectTests(files, suite = 'all') {
  if (!['all', 'unit', 'desktop-1', 'desktop-2', 'desktop-3'].includes(suite)) throw Error('Unknown CI test suite: ' + suite);
  return [...files].filter(file => /\.test\.[cm]?js$/u.test(file)).sort().filter(file => {
    if (suite === 'all') return true;
    const desktop = file.endsWith('-desktop.test.cjs');
    if (suite === 'unit') return !desktop;
    const shard = [...path.basename(file)].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0) % 3 + 1;
    return desktop && suite === 'desktop-' + shard;
  });
}

async function run() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), suite = process.argv[2] ?? 'all';
  const files = selectTests(fs.readdirSync(path.join(root, 'tests')).map(file => 'tests/' + file), suite);
  if (!files.length) throw Error('No tests selected for ' + suite);
  const output = path.join(root, '.qa-ci', suite); fs.mkdirSync(output, { recursive: true });
  const log = fs.createWriteStream(path.join(output, 'tests.log'));
  const started = Date.now();
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', '--test-reporter-destination=' + path.join(output, 'tests.xml'), ...files], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    // Live account tests are deliberately local opt-in; CI never needs account credentials.
    env: { ...process.env, AI_DECK_QA_LIVE: '0' },
  });
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', data => {
    log.write(data); destination.write(data);
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code ?? 1)); });
  log.end(); await finished(log);
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ suite, node: process.version, files, exitCode: code, elapsedMs: Date.now() - started }, null, 2));
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
