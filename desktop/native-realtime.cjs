const { CodexEngine } = require('./engines.cjs');
const { randomUUID } = require('node:crypto');

// The public app-server interface owns OAuth and realtime negotiation. No tokens
// or private transcription endpoints enter the renderer.
function createNativeRealtime({ exe, cwd, threadId, onEvent, Engine = CodexEngine }) {
  let ended = false, timer, resolveSdp, rejectSdp, closing;
  const token = randomUUID();
  const sdp = new Promise((resolve, reject) => { resolveSdp = resolve; rejectSdp = reject; });
  sdp.catch(() => {});
  const engine = new Engine(exe, cwd, [], event => {
    if (ended || event.type !== 'realtime' || event.params.threadId !== threadId) return;
    if (event.method === 'thread/realtime/sdp') {
      const value = event.params.sdp;
      if (typeof value === 'string' && value.length < 100000 && value.startsWith('v=0')) resolveSdp(value);
      else rejectSdp(Error('Codex returned an invalid realtime answer.'));
    } else if (event.method === 'thread/realtime/error' || event.method === 'thread/realtime/closed') {
      rejectSdp(Error('Codex realtime is not available for this connection.'));
      onEvent({ token, type: 'ended', reason: event.method.endsWith('/error') ? 'Codex realtime could not continue. Your text draft is unchanged.' : 'Voice session ended.' });
      void close();
    }
  }, { textOnly: true, nativeExtensions: false, nativeHooks: false });
  function close() {
    if (closing) return closing;
    ended = true; clearTimeout(timer); rejectSdp(Error('Voice session ended.'));
    closing = (async () => {
      let deadline;
      try { await Promise.race([engine.request('thread/realtime/stop', { threadId }), new Promise(resolve => { deadline = setTimeout(resolve, 1500); })]); }
      catch {} finally { clearTimeout(deadline); await engine.close(); }
    })();
    return closing;
  }
  return { token, close, async start(offer) {
    if (typeof offer !== 'string' || offer.length > 100000 || !offer.startsWith('v=0')) throw Error('Invalid microphone negotiation.');
    timer = setTimeout(() => { rejectSdp(Error('Codex realtime connection timed out.')); void close(); }, 20000);
    try {
      await engine.initialize(); if (ended) throw Error('Voice session ended.');
      await engine.request('thread/resume', { threadId, cwd, excludeTurns: true, sandbox: 'read-only', approvalPolicy: 'on-request' });
      if (ended) throw Error('Voice session ended.');
      await engine.request('thread/realtime/start', { threadId, version: 'v3', outputModality: 'audio', transport: { type: 'webrtc', sdp: offer },
        clientManagedHandoffs: true, flushTranscriptTailOnSessionEnd: false,
        prompt: 'Talk with the user in this original conversation. This voice connection is for conversation. Do not execute commands, edit files, start agents, or request UI actions. For work requiring tools, ask the user to send it through this chat composer with their selected permissions.' });
      const answer = await sdp; if (ended) throw Error('Voice session ended.'); clearTimeout(timer);
      return { token, sdp: answer };
    } catch (error) { await close(); throw error; }
  } };
}
module.exports = { createNativeRealtime };
