const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process'), { createInterface } = require('node:readline');
const [mode, folder, name] = process.argv.slice(2);
setInterval(() => {}, 1000);
if (mode === 'leaf') { fs.writeFileSync(path.join(folder, name + '-leaf.json'), JSON.stringify({ pid: process.pid })); return; }
const leaf = spawn(process.execPath, [__filename, 'leaf', folder, name], { windowsHide: true, stdio: 'ignore' });
fs.writeFileSync(path.join(folder, name + '.json'), JSON.stringify({ pid: process.pid, leaf: leaf.pid }));
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
if (mode.startsWith('codex')) createInterface({ input: process.stdin }).on('line', text => {
  const { id, method } = JSON.parse(text);
  if (mode === 'codex-exit') process.exit(2);
  else if (mode === 'codex-error') send({ id, error: { message: 'Controlled initialization failure' } });
  else if (method === 'turn/start') {
    send({ id, result: { turn: { id: 'turn' } } });
    send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
  } else send({ id, result: {} });
});
if (mode.startsWith('claude')) process.stdin.once('data', async () => {
  if (mode === 'claude-stop') return;
  if (mode === 'claude-exit') for (let i = 0; i < 100 && !fs.existsSync(path.join(folder, name + '-leaf.json')); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  send({ type: 'result', result: mode === 'claude-error' ? 'Controlled failure' : 'Fixture answer',
    is_error: mode === 'claude-error', session_id: 'fixture-session' });
  if (mode === 'claude-exit') setImmediate(() => process.exit(0));
});
