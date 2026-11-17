const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNativeRealtime } = require('../desktop/native-realtime.cjs');
test('native voice resumes exact Codex ID and uses native WebRTC without text sends or credentials', async () => {
  const calls = []; let emit, closed = 0;
  class Engine {
    constructor(exe, cwd, plugins, receive, options) { emit = receive; assert.equal(options.textOnly, true); }
    async initialize() {}
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'thread/realtime/start') queueMicrotask(() => emit({ type: 'realtime', method: 'thread/realtime/sdp', params: { threadId: 'original-id', sdp: 'v=0\nanswer' } }));
      return {};
    }
    async close() { closed++; }
  }
  const voice = createNativeRealtime({ exe: 'codex', cwd: process.cwd(), threadId: 'original-id', onEvent() {}, Engine });
  assert.equal((await voice.start('v=0\noffer')).sdp, 'v=0\nanswer');
  assert.deepEqual(calls.map(c => c.method), ['thread/resume', 'thread/realtime/start']);
  assert.equal(calls[0].params.threadId, 'original-id'); assert.equal(calls[0].params.sandbox, 'read-only');
  assert.equal(calls[1].params.transport.type, 'webrtc');
  assert.equal(calls[1].params.version, 'v3');
  await voice.close(); await voice.close(); assert.equal(closed, 1);
});
test('unsupported native realtime does not fork a chat or send a fallback prompt', async () => {
  const calls = []; let closed = 0;
  class Engine {
    async initialize() {}
    async request(method) { calls.push(method); if (method.endsWith('/start')) throw Error('Unsupported'); return {}; }
    async close() { closed++; }
  }
  const voice = createNativeRealtime({ exe: 'codex', cwd: process.cwd(), threadId: 'saved', onEvent() {}, Engine });
  await assert.rejects(voice.start('v=0\noffer'), /Unsupported/); assert.equal(closed, 1);
  assert.ok(!calls.some(s => /fork|turn/.test(s)));
});
