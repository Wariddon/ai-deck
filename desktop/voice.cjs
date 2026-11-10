const { spawn } = require("node:child_process");
const { existsSync, promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sampleRate = 16000;
const maxRecordingSeconds = 30;
const runtime = process.env.AI_DECK_VOICE_DIR || path.join(__dirname, "voice-tools");
const whisper = path.join(runtime, "whisper", "whisper-cli.exe");
const model = path.join(runtime, "models", "ggml-base-q5_1.bin");
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function voiceAvailable() {
  return process.platform === "win32" && existsSync(whisper) && existsSync(model);
}

function recordingBytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 46 || value.byteLength > 44 + sampleRate * maxRecordingSeconds * 2) {
    throw new Error("Record up to 30 seconds of audio.");
  }
  const bytes = Buffer.from(value);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.readUInt32LE(4) !== bytes.length - 8 ||
      bytes.toString("ascii", 8, 16) !== "WAVEfmt " || bytes.readUInt32LE(16) !== 16 ||
      bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== sampleRate ||
      bytes.readUInt32LE(28) !== sampleRate * 2 || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 ||
      bytes.toString("ascii", 36, 40) !== "data" || bytes.readUInt32LE(40) !== bytes.length - 44 || bytes.length % 2) {
    throw new Error("Could not decode the microphone recording.");
  }
  return bytes;
}

function voiceProcess(exe, args, signal, timeoutMs, failed) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: "ignore" });
    let expired = false;
    const stop = () => child.kill();
    const timer = setTimeout(() => { expired = true; stop(); }, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    child.once("error", () => reject(new Error(failed)));
    child.once("close", (code) => {
      signal.removeEventListener("abort", stop);
      clearTimeout(timer);
      if (signal.aborted) reject(new Error("Voice cancelled."));
      else if (expired) reject(new Error("Voice processing timed out. Try a shorter message."));
      else if (code === 3 && exe === powershell) reject(new Error("Install the reply language voice in Windows Settings > Time & language > Speech."));
      else if (code !== 0) reject(new Error(failed));
      else resolve();
    });
  });
}

async function withAudioFiles(callback) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ai-deck-voice-"));
  try { return await callback(folder); }
  finally {
    await Promise.all(["mic.wav", "transcript.txt", "reply.txt", "reply.wav"].map((file) => fs.unlink(path.join(folder, file)).catch(() => {})));
    await fs.rmdir(folder).catch(() => {});
  }
}

async function transcribe(value, language, signal) {
  if (!voiceAvailable()) throw new Error("Voice transcription files are missing from this installation.");
  if (!["th", "en"].includes(language)) throw new Error("Choose Thai or English for the microphone.");
  const bytes = recordingBytes(value);
  let peak = 0;
  for (let offset = 44; offset < bytes.length; offset += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
  if (peak < 120) return "";
  return withAudioFiles(async (folder) => {
    const input = path.join(folder, "mic.wav");
    const output = path.join(folder, "transcript");
    await fs.writeFile(input, bytes);
    await voiceProcess(whisper, ["-m", model, "-f", input, "-l", language, "-t", "2", "-ng", "-nt", "-sns", "-otxt", "-of", output],
      signal, 75000, "Could not transcribe the recording.");
    const text = (await fs.readFile(output + ".txt", "utf8")).trim().slice(0, 4000);
    return /^[\s.\[\]…()]*$/u.test(text) ? "" : text;
  });
}

async function speak(value, signal) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new Error("No spoken reply is available.");
  return withAudioFiles(async (folder) => {
    const input = path.join(folder, "reply.txt");
    const output = path.join(folder, "reply.wav");
    await fs.writeFile(input, value, "utf8");
    await voiceProcess(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "voice-windows.ps1"), "-InputFile", input, "-OutputFile", output],
      signal, 20000, "Windows could not generate the spoken reply.");
    const { size } = await fs.stat(output);
    if (size > 12 * 1024 * 1024) throw new Error("The spoken reply exceeds the audio limit.");
    return new Uint8Array(await fs.readFile(output));
  });
}

module.exports = { voiceAvailable, transcribe, speak };
