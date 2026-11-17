import { useEffect, useRef, useState } from 'react';
import { IconWaveSine, IconPlayerStop } from '@tabler/icons-react';

export function NativeVoice({ api, session, disabled, changed, refresh }) {
  const current = useRef(null), alive = useRef(true);
  const [stage, setStage] = useState('idle'), [error, setError] = useState('');
  async function stop(job = current.current) {
    if (!job || job !== current.current) return;
    current.current = null;
    job.stream?.getTracks().forEach(t => t.stop()); job.peer?.close();
    if (job.audio) { job.audio.pause(); job.audio.srcObject = null; }
    await api['native-voice-stop']({ id: job.id }).catch(() => {});
    if (alive.current) { setStage('idle'); changed(false); void refresh(); }
  }
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) void stop(); };
    document.addEventListener('visibilitychange', hidden);
    const off = api.onEvent(e => { if (e.type === 'native-voice-ended' && e.id === current.current?.id) { setError(e.reason); void stop(); } });
    return () => { alive.current = false; document.removeEventListener('visibilitychange', hidden); off(); void stop(); };
  }, [api]);
  async function start() {
    if (disabled || current.current) return;
    const job = { id: crypto.randomUUID() }; current.current = job; changed(true); setStage('connecting'); setError('');
    try {
      job.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (current.current !== job) { job.stream.getTracks().forEach(t => t.stop()); return; }
      job.peer = new RTCPeerConnection();
      for (const track of job.stream.getTracks()) job.peer.addTrack(track, job.stream);
      // Configure both the audio m-line and official events channel before offer.
      job.channel = job.peer.createDataChannel('oai-events');
      job.audio = new Audio(); job.audio.autoplay = true;
      job.peer.ontrack = e => { if (current.current !== job) return; job.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); void job.audio.play().catch(() => { if (current.current === job) setError('Allow audio playback to hear Codex.'); }); };
      job.peer.onconnectionstatechange = () => {
        if (current.current !== job) return;
        if (job.peer.connectionState === 'connected') setStage('talking');
        if (['failed', 'closed', 'disconnected'].includes(job.peer.connectionState)) { setError('Voice connection ended.'); void stop(job); }
      };
      await job.peer.setLocalDescription(await job.peer.createOffer());
      if (current.current !== job) return;
      const answer = await api['native-voice-start']({ ...session, id: session.id, voiceId: job.id, sdp: job.peer.localDescription.sdp });
      if (current.current !== job) { await api['native-voice-stop']({ id: job.id }); return; }
      await job.peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (e) {
      if (current.current !== job) return;
      setError(e.message?.replace(/^Error invoking remote method '[^']+': Error: /u, '') || 'Voice could not connect.');
      await stop(job);
    }
  }
  return <span className="deck-native-voice"><button className="button small" type="button" disabled={disabled && stage === 'idle'}
    title="Codex native voice · conversation only; tools use the text composer" aria-label={stage === 'idle' ? 'Start Codex voice' : 'End Codex voice'}
    onClick={() => stage === 'idle' ? start() : stop()}>{stage === 'idle' ? <IconWaveSine size={16} /> : <IconPlayerStop size={16} />}
    {stage === 'connecting' ? 'Connecting…' : stage === 'talking' ? 'Listening · Stop' : 'Voice'}</button>
    {error && <small role="status">{error}</small>}</span>;
}
