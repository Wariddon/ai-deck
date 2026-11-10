# AI Deck

AI Deck is a Windows desktop workspace for running Codex CLI and Claude Code in the same task. It includes team workflows, session roles, shared skills, usage reporting, a task inbox, and Git worktrees.

## Quick start on Windows

Install Git for Windows and Node.js 24 on Windows x64. In PowerShell, run:

```powershell
git clone https://github.com/Wariddon/ai-deck.git
cd ai-deck
npm.cmd ci
npm.cmd start
```

`npm.cmd start` builds the renderer and launches the desktop app. The first install downloads Electron and the npm dependencies.

Install and sign in to the Codex CLI, Claude Code, or both on your own machine. Open **Connections** in AI Deck to verify sign-in. If a CLI is missing, select its Windows executable there and refresh. One connected CLI is enough for solo work. Team discussion and two-agent workflows require both.

Open a Git repository from **Projects**. Use **Team plan** beside the composer to assign roles. Use `/discuss` to start a discussion between Codex and Claude without opening the project for edits. Account sign-in, workspace settings, and chat history are local to each user.

## Test and package

```powershell
npm.cmd test
npm.cmd run package:windows
```

Packaging prints the paths to the staged executable and the portable ZIP. Unzip the entire archive and run `AI Deck.exe`. Recipients configure their own CLIs. Leave `AI_DECK_CODEX_EXE` and `AI_DECK_CLAUDE_EXE` unset when building for others. Those optional overrides embed absolute executable paths for machine-local builds.

Voice transcription is optional. To enable it from source or bundle it into the ZIP, set `AI_DECK_VOICE_DIR` to a folder with the Windows Whisper binaries and license in `whisper/` and `ggml-base-q5_1.bin` in `models/`.

Each successful package prunes expired staging folders created by the same checkout. The two newest successful stages, stages less than 30 minutes old, and stages referenced by running processes are kept. Use `npm.cmd run package:windows -- --keep-stage` to retain a QA stage.
