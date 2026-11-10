import { useEffect, useRef, useState } from "react";
import { IconMicrophone, IconPlayerStop, IconVolume, IconWaveSine } from "@tabler/icons-react";
import { agentOutput } from "../desktop/collaboration.mjs";

const sampleRate = 16000;
const maxSeconds = 30;

async function microphoneWave(chunks) {
  const source = new Blob(chunks);
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const audio = await context.decodeAudioData(await source.arrayBuffer());
  const samples = audio.getChannelData(0).subarray(0, sampleRate * maxSeconds);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const header = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0); // RIFF
  header.setUint32(4, bytes.length - 8, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8); // WAVEfmt
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  bytes.set([100, 97, 116, 97], 36); // data
  header.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    header.setInt16(44 + index * 2, Math.round(Math.min(1, Math.max(-1, samples[index])) * 32767), true);
  }
  return bytes;
}

function spokenReply(run) {
  const agent = run.timeline?.findLast(({ agent, kind }) => kind === "message" && run.agents[agent]?.status === "completed")?.agent;
  const record = run.agents[agent] ?? Object.values(run.agents).findLast((entry) => entry.status === "completed" && agentOutput(entry));
  return agentOutput(record).replace(/```[\s\S]*?(?:```|$)/gu, " ")
    .replace(/!?\[([^\]]+)\]\([^\n)]+\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/^[\s#>*-]+/gmu, "").replace(/[`*_]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 1000);
}

function voiceError(error) {
  if (error?.name === "NotAllowedError") return "Microphone access was denied. Check Windows Settings > Privacy & security > Microphone.";
  if (error?.name === "NotFoundError") return "Connect a microphone and try again.";
  if (error?.name === "NotReadableError") return "Windows could not open the microphone. Check the selected input device.";
  return error?.message?.replace(/^Error invoking remote method '[^']+': Error: /u, "") || "Voice chat could not complete.";
}

function dispose(api, job) {
  clearTimeout(job.timer);
  job.stream?.getTracks().forEach((track) => track.stop());
  if (job.recorder?.state === "recording") job.recorder.stop();
  if (job.audio) {
    job.audio.pause();
    job.audio.removeAttribute("src");
    job.audio.load();
    URL.revokeObjectURL(job.url);
  }
  void api["voice-cancel"]({ id: job.id }).catch(() => {});
}

export function VoiceChat({ api, taskId, locked, run, runId, preferences, onTranscript, children }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState(preferences.voiceLanguage);
  const [read, setRead] = useState(preferences.readReplies);
  const [stage, setStage] = useState("idle");
  const [notice, setNotice] = useState("");
  const [available, setAvailable] = useState(null);
  const [reply, setReply] = useState("");
  const current = useRef(null);
  const toggle = useRef(null);
  const seen = useRef(null);

  function end(job = current.current) {
    if (!job || job !== current.current) return;
    current.current = null;
    dispose(api, job);
    setStage("idle");
  }

  function close() {
    end();
    setOpen(false);
    setNotice("");
    setReply("");
    toggle.current?.focus();
  }

  useEffect(() => {
    function hidden() {
      if (document.hidden && current.current) {
        const job = current.current;
        current.current = null;
        dispose(api, job);
        setStage("idle");
        setNotice("Voice paused while the window was hidden.");
      }
    }
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      if (current.current) {
        const job = current.current;
        current.current = null;
        dispose(api, job);
      }
    };
  }, [api]);

  useEffect(() => {
    if (locked && current.current) {
      end();
      setNotice("Voice is ready again after the agents finish.");
    }
    if (!open || locked || !run?.finishedAt || run.id === seen.current || run.id !== runId) return;
    seen.current = run.id;
    const text = spokenReply(run);
    if (!text) return;
    setReply(text);
    if (read && !document.hidden && !current.current) void play(text);
  }, [open, locked, run, runId, read]);

  async function play(text) {
    if (!text || current.current || locked) return;
    const job = { id: crypto.randomUUID() };
    current.current = job;
    setStage("preparing");
    setNotice("");
    try {
      const bytes = await api["voice-speak"]({ id: job.id, taskId, text });
      if (job !== current.current) return;
      job.url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      job.audio = new Audio(job.url);
      job.audio.onended = () => end(job);
      job.audio.onerror = () => {
        if (job !== current.current) return;
        end(job);
        setNotice("Could not play the spoken reply.");
      };
      await job.audio.play();
      if (job === current.current) setStage("playing");
    } catch (error) {
      if (job !== current.current) return;
      end(job);
      setNotice(voiceError(error));
    }
  }

  async function record() {
    if (locked || current.current) return;
    const job = { id: crypto.randomUUID() };
    current.current = job;
    setStage("opening");
    setNotice("");
    try {
      await api["voice-arm"]({ id: job.id, taskId });
      if (job !== current.current) return;
      job.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (job !== current.current) {
        job.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks = [];
      const recorder = new MediaRecorder(job.stream);
      job.recorder = recorder;
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onerror = () => {
        if (job !== current.current) return;
        end(job);
        setNotice("The microphone recording stopped. Try again.");
      };
      recorder.onstop = async () => {
        clearTimeout(job.timer);
        job.stream.getTracks().forEach((track) => track.stop());
        if (job !== current.current) return;
        setStage("transcribing");
        try {
          const audio = await microphoneWave(chunks);
          if (job !== current.current) return;
          const text = await api["voice-transcribe"]({ id: job.id, taskId, language, audio });
          if (job !== current.current) return;
          if (text) onTranscript(text);
          setNotice(text ? "Transcript added. Review it before sending." : "No speech detected. Try speaking closer to the microphone.");
        } catch (error) {
          if (job === current.current) setNotice(voiceError(error));
        } finally { end(job); }
      };
      recorder.start();
      job.timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, maxSeconds * 1000);
      setStage("recording");
    } catch (error) {
      if (job !== current.current) return;
      end(job);
      setNotice(voiceError(error));
    }
  }

  async function toggleVoice() {
    if (open) { close(); return; }
    seen.current = run?.id;
    setLanguage(preferences.voiceLanguage);
    setRead(preferences.readReplies);
    setOpen(true);
    try {
      const ready = await api["voice-status"]();
      setAvailable(ready);
      if (!ready) setNotice("Voice transcription files are missing from this installation.");
    } catch (error) { setNotice(voiceError(error)); }
  }

  const status = {
    opening: "Opening microphone…", recording: "Recording · up to 30 seconds",
    transcribing: "Transcribing on this PC…", preparing: "Preparing spoken reply…", playing: "Reading reply aloud…",
  }[stage];
  return <>
    <div className="thread-actions">
      {taskId && <button ref={toggle} className="button small deck-voice-toggle" type="button" aria-label={open ? "End voice chat" : "Start voice chat"}
        title={open ? "End voice chat" : "Start voice chat"} aria-expanded={open} aria-controls={open ? "deck-voice-panel" : undefined}
        disabled={!open && locked} onClick={toggleVoice}><IconWaveSine size={17} /></button>}
      {children}
    </div>
    {open && <div className="deck-voice-panel" id="deck-voice-panel" role="group" aria-label="Voice chat">
      <strong>Voice chat</strong>
      <select aria-label="Microphone language" value={language} disabled={stage !== "idle"} onChange={(event) => setLanguage(event.target.value)}>
        <option value="th">ไทย</option><option value="en">English</option>
      </select>
      {stage === "recording" ? <button className="button small primary" type="button" onClick={() => current.current?.recorder.stop()}>
        <IconPlayerStop size={14} />Stop recording</button> : <button className="button small" type="button" disabled={locked || available !== true || stage !== "idle"} onClick={record}>
        <IconMicrophone size={14} />Record</button>}
      <label className="deck-voice-read" title="Read up to the first 1,000 characters of a finished reply">
        <input type="checkbox" checked={read} onChange={(event) => {
          setRead(event.target.checked);
          if (!event.target.checked && ["preparing", "playing"].includes(stage)) end();
        }} />Read replies
      </label>
      {stage !== "idle" ? <button className="button small" type="button" onClick={() => { end(); setNotice(""); }}>
        {["preparing", "playing"].includes(stage) ? "Stop audio" : "Cancel"}</button>
        : reply && <button className="button small" type="button" disabled={locked} onClick={() => play(reply)}><IconVolume size={14} />Play reply</button>}
      <span className="deck-voice-status" role="status">{status || notice || (locked ? "Waiting for agents…" : "Record a message, then review and send.")}</span>
    </div>}
  </>;
}
