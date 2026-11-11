# AI Deck

AI Deck is a Windows desktop workspace for running Codex CLI and Claude Code in the same task. It includes team workflows, session roles, shared skills, usage reporting, in-chat approvals and Git worktrees.

Current desktop version: **0.9.142**. See [validation and release scope](docs/validation.md) for the checks performed and their limits.

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

Open a Git repository from **Projects** for file work. The saved team runs from the ordinary composer; **Session Team** lets you change its members and roles. Recents can continue a native Codex or Claude chat without Git. Account sign-in, workspace settings, and chat history are local to each user.

## Multiple chats at once

Start a task, then choose another chat or **New task** in the sidebar. The earlier job keeps running, with an activity ring beside its name. Stop, approvals and follow-up queues apply to the selected job. Reopening a running chat restores its available reply and pending requests.

The app runs up to two independent jobs at once by default, or one with **Low RAM** enabled. Additional jobs wait for a slot or available memory. Jobs that use the same original provider conversation or overlapping writable folders wait for each other. Project tasks use their own Git worktrees, and members inside a team keep their configured execution order. Waiting project requests recover as paused messages after restart; they are not sent again automatically.

Original Codex and Claude conversations retain their provider session IDs. The app verifies the recorded folder and transcript before each send. Choose the permission mode below the composer when you want file or command tools; **Chat only** does not require Git.

## Automatic Git and code tools

Project turns automatically receive a small, checkout-scoped MCP toolset for Git reads and Serena symbol/reference lookup. Both providers can use it, including reviewers. File edits keep the existing native tools and permission mode. Bounded tool observations are quoted to the next teammate and attributed in the run details. Services close when the run ends or is stopped; there is no feature switch.

Serena starts on the first code lookup. With Python 3.11 or newer available, AI Deck prepares a private, commit-pinned runtime and language-server dependencies on first use. If preparation or a lookup is unavailable, it identifies the fallback as a partial local JS/TS graph. For a packaged installation the runtime is under the app's `tools` directory; source runs use the desktop profile's `tool-runtimes` directory.

Requests mentioning GitHub, PRs, issues, CI or workflows also receive a read-only GitHub MCP tool bound to the checkout's `github.com` origin. It uses `GH_TOKEN`, `GITHUB_TOKEN`, or existing Git Credential Manager authentication in memory. A Codex connector sign-in is separate. Missing GitHub access does not disable local Git or code tools. The curated tools do not commit, push, merge or publish, and they do not invoke another LLM; their returned evidence still contributes to the model's context.

## Test and package

```powershell
npm.cmd test
npm.cmd run package:windows
```

Packaging prints the paths to the staged executable and the portable ZIP. Unzip the entire archive and run `AI Deck.exe`. Recipients configure their own CLIs. Leave `AI_DECK_CODEX_EXE` and `AI_DECK_CLAUDE_EXE` unset when building for others. Those optional overrides embed absolute executable paths for machine-local builds.

Voice transcription is optional. To enable it from source or bundle it into the ZIP, set `AI_DECK_VOICE_DIR` to a folder with the Windows Whisper binaries and license in `whisper/` and `ggml-base-q5_1.bin` in `models/`.

Each successful package prunes expired staging folders created by the same checkout. The two newest successful stages, stages less than 30 minutes old, and stages referenced by running processes are kept. Use `npm.cmd run package:windows -- --keep-stage` to retain a QA stage.
