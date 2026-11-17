<p align="center">
  <img src="desktop/notification-icon.png" width="112" height="112" alt="AI Deck logo: three white layers on a blue circle" />
</p>

<h1 align="center">AI Deck</h1>

<p align="center">Codex + Claude Code, working together in one desktop workspace.</p>

<p align="center">
  <strong>Windows x64 · Desktop 0.9.178</strong><br />
  <a href="#quick-start-on-windows">Quick start</a> ·
  <a href="#working-with-a-team">Team workflows</a> ·
  <a href="docs/validation.md">Validation &amp; limitations</a>
</p>

AI Deck connects your signed-in Codex CLI and Claude Code so you can continue existing chats, assign team roles, pass evidence between agents and read the combined answer in one place. You can run either provider alone; both providers are needed for a Codex–Claude team. You do not need to keep their desktop apps open.

Project teams automatically receive bounded shared guidance for planning and handoffs. Code reviews add behavioral-test guidance; changed error paths also add failure-visibility checks. The bundled `ai-deck-team-review` adapts [Superpowers Writing Plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md) and [Anthropic PR Review Toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit) for the assigned members. It does not launch additional reviewers or add provider turns, works in either Codex/Claude role order and Session Team, and keeps the original permissions and turn limits.

Project plans carry the inputs each assignment needs, the outputs it must deliver and the conditions the next member must verify. AI Deck automatically saves and forwards these with the existing plan and evidence, including after a paused review or app restart. Requirements remain separate from observed checks; a completed reply does not establish that a handoff condition passed. Ordinary team handoffs use the same guidance in their existing reports, with no additional setup buttons.

## Latest update · 0.9.178

- A delayed Model/Effort/Speed save applies only the selected provider and scope. It preserves newer job completion, replies and drafts rather than restoring an earlier workspace snapshot and a stuck loading ring.
- Parallel native chats retain separate model choices and newer drafts through rapid switching, queued work and duplicate-submit attempts. Restart restores the saved choices and drafts without replaying requests. See [validation](docs/validation.md).

- Equivalent Model/Effort/Speed settings keep the same member-check bucket regardless of saved field order. Switching to different values still starts a separate bucket.
- Member scores retain their bounded check snapshots when long command activity scrolls out of the compact history. A matched failure cannot disappear behind later command output, and test filenames containing `build` remain test results.
- Concurrent member runs preserve their selected controls, drafts and original builder chat IDs, including after restart. Verification uses controlled provider transports; Claude inference remains skipped. See [validation](docs/validation.md).

- Team members receive short verification guides automatically in ordinary project turns. The guides use local observed check counts for that project/member/role/model/settings bucket and preserve your chosen team, Model, Effort, Speed and permissions.
- Only current attributed native check outcomes contribute samples; model prose, reviewer agreement, quota failures and interrupted runs do not establish ability. Counts show their sample size and remain unrated when evidence or the model identity is unknown.
- Queued and waiting work freezes its guide snapshot. Original builder conversations continue, existing history/guidance sharing opt-outs apply, and no training jobs, new model calls or primary controls are added. See [member learning](docs/member-learning.md) for scope and limits.

- General's Quit action saves all pending chat drafts first. A failed write keeps the app open with an explanation so unsent text can be recovered.
- Portable packages never embed the builder's CLI-path environment overrides. Their starter guide matches the thirteen current Settings categories and ordinary chat flows.
- Packaging verifies the README/version/source modules and writes a relative-path SHA-256 release manifest. It reports the finished archive's digest; modified, missing, linked or known profile files fail verification. See [release verification](docs/release-verification.md) for the checks and proof limits.

- Explicit browser requests no longer confuse source-code words such as `edge cases` with Microsoft Edge. Creating a tab through the native tab-list tool requires approval, as do native clicks, dragging and browser changes.
- Closing window access settles pending actions; expired control observations cannot apply later. Voice helpers clean up their owned process trees, and switching chats/projects or minimizing cancels the old voice operation without forwarding its transcript.
- Cloud reads have a caller deadline and cancellation even for an unresponsive reader. Malformed or repeated task rows cannot crash or duplicate the list. See [screen, browser, voice and Cloud](docs/screen-browser-voice-cloud.md) for actual interface support and validation limits.

- Concurrent code lookups now receive their own worker response, including when projects share folder and symbol names. Cancelling one lookup leaves its peer available; source reads stay bounded even for skipped binary/invalid files.
- Serena profiles and project metadata are isolated by the physical checkout. The app prepares its missing `uv/uvx` dependency and exposes the runtime's executable folder only to its child process. Unavailable semantic tools fall back to clearly labeled JS/TS graphs or bounded literal searches for other source languages.
- Saved context carries its source revision/hash and flags changed or missing origins without automatically sharing new text. Team Decisions require the matching repository; report-only reviewers receive no built-in repository tool lease. See [memory, context and code tools](docs/context-and-code.md) for scope and limits.

- Comparing team worktrees now binds staging, branch, HEAD and physical Git identity, so staging-only changes invalidate an earlier comparison. Replay checks the source identity again before accepting its candidate and rejects foreign or identical source/destination checkouts.
- Updating a task to a newer base verifies its managed Git owner and unchanged source before publishing a separate task. Failed integration keeps the original worktrees and removes the temporary candidate.
- Undo Apply records where the applied text was observed. It preserves unrelated edits when those positions remain identifiable and stops when the block moved or was replaced. See [integration and Git conflicts](docs/integration-git.md) for the supported boundaries.

- Saved plans can reference exact build, API and UI check commands through normal chat. Artifact hashes captured at command completion bind measured JSON values to their observed checks; changed or missing receipts cannot inherit an earlier pass.
- Handoff evidence distinguishes verified values, recorded evidence, incomplete proof, stale snapshots and failed checks. Explicit missing evidence pauses automatic follow-ups and integration while chat stays available.
- Local target/environment assertions and bounded screenshot hashes use the existing plan and evidence views. See [observable acceptance](docs/observable-acceptance.md) for examples and proof boundaries; no additional controls or provider turns are added.

- Review corrections return to the unique recorded owner of the affected files, including an earlier writer or an actual tree ancestor. Ambiguous ownership and findings from another branch stay available for a new plan.
- Dependent work waits for ready plans and current, passing reviews, including reviews above an intermediate report. Independent branches can continue; changed team requirements pause the remaining automatic handoffs and queued follow-ups.
- Structured findings survive long report previews and travel through the existing sharing controls. The one-repair budget, native builder chat, permissions and serial writes remain in place, with no new controls or extra planning turns.

- New messages cannot jump ahead of an older eligible waiting job. A waiter blocked by its working folder still allows independent work to proceed.
- Closing the run pool cancels pending preparation, rejects later submissions and clears waiting timers. Stop continues to target the selected job.
- Forced provider and code-tool cleanup terminates the owned process tree on Windows and awaits project-tool closure before releasing its slot. Late tool initialization cannot reopen access after Stop; remote tool cancellation stays scoped to its own client.

- Startup releases the workspace when a metadata reader ignores cancellation. A stalled connection, history or quota check cannot keep the loading screen pending indefinitely; a failed provider preserves its last known chats.
- Normal startup reads independent account quotas together, while Low RAM keeps them sequential. Startup still performs no model turns and yields metadata work to foreground actions.
- Long original chats format nearby replies first and keep offscreen text available for search. Scrolling back retains revealed code blocks and their wrap state; typing continues to reuse loaded history.

- Rapid chat switches keep the latest selected task and draft, even when earlier results arrive afterward. Returning to the current task also cancels a pending selection of another task.
- Delayed selection, permission and session-management results preserve the page you chose most recently. Overlapping foreground operations keep their busy state until all have settled.
- One-click forks can prepare a draft while another independent chat is running, preserving the source and leaving execution permissions and destination checks in place.

- Plans can attach observable JSON values to handoff conditions, using exact values or numeric bounds. Current files and matching executed checks must support those values; a reviewer's PASS cannot replace missing or failed measurements.
- Required checks bind their command definitions and results to the exact final checkout. Combining worktrees verifies their Git repository and source HEAD, and invalidates a candidate that changes during review.
- Handoff contracts share one final Git observation after their artifact reads, reducing repeated Git work without background polling or extra model turns. Existing evidence details show expected and observed values.

- Native sends have an atomic local checkpoint before the CLI runs. Reopening checks the original transcript, retains uncertain sends and rejects duplicate request or draft identities without replaying a model turn.
- Batched native text drafts have a main-process checkpoint and persistent edit identities. Forced termination preserves saved drafts and newer identical follow-ups; interrupted partial replies remain available in the chat.
- Persistent team builder IDs are saved when first reported, and partial team progress is checkpointed during execution. Restart keeps recorded results and queued follow-ups paused.

- Session Team can send one scoped review correction back to the original builder and run a fresh recheck, within the saved turn budget. Unverified snapshots and out-of-scope findings retain their review notes instead of starting a repair.
- Plans can connect handoff conditions to relative files and observed test commands. The existing review details show file hashes, test outcomes and the matching code snapshot; condition text is never executed.

- Typing in long original chats reuses the loaded history; command output loads when its details are opened.
- Shared plans preserve inputs, outputs and handoff conditions through existing Codex/Claude turns. Session Team shows the saved plan as soon as its planner hands it over.
- Per-chat drafts and model choices stay separate through navigation and restart. One-click forks open Team, Codex or Claude drafts directly.
- Expired provider sign-in is reported without automatically resending the message. Activity history keeps the latest 80 steps.
- Verified CLI paths are saved in the local profile so replacing a portable build can omit machine-local defaults. Refreshing a chat keeps loaded older messages and their pagination position.

Validation includes focused concurrency and process-lifecycle checks, controlled desktop scenarios and earlier bounded live-provider checks; see [validation and release scope](docs/validation.md) for current results and proof boundaries. The preceding 0.9.168 baseline passed all 397 tests.

## What you can do

| Feature | How it works |
| --- | --- |
| Continue existing chats | Recents opens the original Codex or Claude conversation and keeps its native session ID. Chat only works without Git. |
| Work as a team | Choose members, roles, models and handoff order in Session Team. A builder can pass its changes and evidence to a reviewer. |
| Share context | Use project instructions, selected messages, local notes and skill snapshots, with sharing controlled per team. |
| Attach files | Paste or drop images, PDF, DOCX, XLSX and UTF-8 files. Document extraction and Thai/English scanned-PDF OCR run locally. |
| Control each chat | Choose the provider's available Model, Effort and Speed, plus Chat only, Ask for approval, Approve for me or Full access. |
| Follow progress | See session activity, question times, queued follow-ups, expandable work steps and completion notifications. |
| Track usage | View reported account limits, reset times and per-run token reports separately. Unknown usage stays unknown. |
| Keep work isolated | Run independent sessions on verified Git worktrees, with bounded concurrency and a Low RAM option. |

This is an actively developed application. Provider/account capabilities vary, and AI Deck does not reproduce every feature of the native desktop apps. See [validation and release scope](docs/validation.md) for exercised paths and proof boundaries.

## Quick start on Windows

Install Git for Windows and Node.js 24 on Windows x64. In PowerShell, run:

```powershell
git clone https://github.com/Wariddon/ai-deck.git
cd ai-deck
npm.cmd ci
npm.cmd start
```

`npm.cmd ci` installs the npm dependencies. `npm.cmd start` prepares the Electron runtime, builds the renderer and launches the desktop app. The first start or test run may download Electron; later runs reuse that runtime. Tests finish this preparation first, then run serially to keep desktop and document probes within predictable resource limits.

GitHub Actions checks every push and pull request on Windows with Node 24. One unit suite and three deterministic desktop shards cover every discovered test exactly once; each shard runs serially. The jobs prepare Electron, build the app and retain JUnit/log summaries for seven days. No provider credentials or live model requests are used in CI. To repeat a suite locally after building, run `node scripts/ci-tests.mjs unit` or `desktop-1`, `desktop-2`, `desktop-3`; omit the suite to run all tests serially.

Recovery checks exercise an owned QA app crash, durable duplicate-send fences and a real loopback TCP reset after acceptance. A short resource probe runs ten two-active/one-waiting cycles and records retained renderer heap, idle CPU, working set and process count. It separates test-only garbage collection from idle CPU sampling.

Real Codex/Claude recovery is a separate local opt-in test using the currently signed-in CLIs and named disposable QA conversations. Set `AI_DECK_QA_LIVE=1` before running `node --test --test-concurrency=1 tests/live-native-recovery-desktop.test.cjs`; it uses account quota. It interrupts only its own QA process tree, checks no automatic replay and resumes the same native chat to verify retained context. CI explicitly disables these live calls and never uploads account/profile directories.

Install and sign in to the Codex CLI, Claude Code, or both on your own machine. Open **Connections** in AI Deck to verify sign-in. If a CLI is missing, select its Windows executable there and refresh. One connected CLI is enough for solo work. Team discussion and two-agent workflows require both.

Open a Git repository from **Projects** for project file work, or pull **Recents** to continue an existing provider chat. Account sign-in, workspace settings, drafts and chat history stay in your own local profile; cloning this repository does not include another user's account or conversations.

## Working with a team

1. Open a task and choose **Session Team** below the composer.
2. Set each member's provider, role, model and responsibilities. Reorder members or use the team map to define handoffs.
3. Send your request normally. The next member receives the permitted brief, relevant evidence and upstream report.
4. Read the combined answer in the chat; expand work steps and individual reports when needed.

The compact direction picker inside the composer switches between **Codex → Claude**, **Claude → Codex** and bounded two-way discussion. **Fork to Team**, **Fork to Codex** and **Fork to Claude** open a new chat immediately from Recents or Chat actions, without a setup form or a model call. Up to six recent saved messages are included as quoted context. AI Deck prefers the verified source project, otherwise the current verified project, and keeps **Permissions** below the composer for your choice. The source chat and draft stay unchanged. If no project is available, you can still chat without Git; file tools need a project. Optional Gemini and local Ollama members are configured in **Accounts & connections**, with separate data-sharing controls.

New persistent provider chats get a short name from the task without an extra model request. Rename a session through its **…** menu or **F2**. Resumed chats keep their names and IDs. Running chats show an activity ring; waiting for a resource or an approval has its own status.

An older incomplete plan appears as a quiet note while chat stays available. Hiding the note preserves its evidence in Run history and does not approve edits or change the checkout.

## Multiple chats at once

Start a task, then choose another chat or **New task** in the sidebar. The earlier job keeps running, with an activity ring beside its name. Stop, approvals and follow-up queues apply to the selected job. Reopening a running chat restores its available reply and pending requests.

The app runs up to two independent jobs at once by default, or one with **Low RAM** enabled. Additional jobs wait for a slot or available memory. Jobs that use the same original provider conversation or overlapping writable folders wait for each other. Project tasks use their own Git worktrees, and members inside a team keep their configured execution order. Waiting project requests recover as paused messages after restart; they are not sent again automatically.

Original Codex and Claude conversations retain their provider session IDs. The app verifies the recorded folder and transcript before each send. Choose the permission mode below the composer when you want file or command tools; **Chat only** does not require Git.

The model button beside permissions sets **Model**, **Effort** and **Speed** for the original chat. The list comes from the connected provider; Fast is enabled only for reported model/account support. Choices are saved per provider, native conversation ID and verified folder. Leaving a field at its chat default preserves the original CLI behavior. Changes apply on the next send and do not create a new conversation or change its permissions.

## Files, screenshots and browser tools

Use the paperclip for files, screenshot preview or a one-turn window share. Images appear as thumbnails inside the composer. Original Recents chats use the same extraction/OCR pipeline as team tasks, and attachment drafts survive reopening the app. Delayed imports merge with the latest draft rather than replacing newer text or files.

Both reviewers can search task text and read source lines through bounded read-only tools. The shared-window bridge supports accessible controls, scrolling and navigation keys, with fresh inspection and one-action approval. It controls one selected window at a time. Hiding or minimizing AI Deck ends window access; **Stop sharing** is separate from stopping the model. Window access does not increase file permissions.

An explicit Chrome request to Claude, such as `@Chrome`, enables Claude Code's native Chrome integration for that turn. Install/connect the provider's official browser extension first. Ordinary messages do not load Chrome tools. Browser changes retain one-action approval even with Full access for files, and hiding AI Deck ends the browser turn.

The Codex Cloud bridge can read task lists, status and diffs through the signed-in official CLI. It does not create or apply cloud tasks. Native local-memory preferences and opt-outs are preserved; private ChatGPT/Claude account memory is not copied between providers.

Arbitrary coordinate dragging, simultaneous multi-window control, native realtime voice and full provider-cloud workspace management are not implemented. Voice supports local transcription, chat and Windows text-to-speech when the optional runtime is available.

## Settings and updates

Settings has 13 searchable categories: **General**, **Appearance**, **Notifications**, **Accounts & connections**, **Voice**, **Models**, **Project**, **Shared knowledge**, **Skills & plugins**, **Screen & browser**, **Hooks**, **Git & worktrees** and **Advanced settings**.

UI scale and text size are saved locally. Keyboard help lives in General, archives in Recents, and billing/account limits in Usage. Infrequent import, provider configuration, storage and privacy actions are grouped in Advanced. Local scheduling has been removed; earlier schedule history is retained paused and is not replayed.

The header bell checks Codex and Claude desktop/CLI update metadata while idle, remembers read versions and opens official update pages. Desktop availability comes from the Windows catalog; CLI releases come from publisher package catalogs, respecting Claude's stable channel. It does not install updates or send model prompts automatically. Unknown or offline checks do not create new update alerts.

## Automatic Git and code tools

Project turns automatically receive a small, checkout-scoped MCP toolset for Git reads and Serena symbol/reference lookup. Both providers can use it, including reviewers. File edits keep the existing native tools and permission mode. Bounded tool observations are quoted to the next teammate and attributed in the run details. Services close when the run ends or is stopped; there is no feature switch.

Serena starts on the first code lookup. With Python 3.11 or newer available, AI Deck prepares a private, commit-pinned runtime and language-server dependencies on first use. If preparation or a lookup is unavailable, it identifies the fallback as a partial local JS/TS graph. For a packaged installation the runtime is under the app's `tools` directory; source runs use the desktop profile's `tool-runtimes` directory.

Requests mentioning GitHub, PRs, issues, CI or workflows also receive a read-only GitHub MCP tool bound to the checkout's `github.com` origin. It uses `GH_TOKEN`, `GITHUB_TOKEN`, or existing Git Credential Manager authentication in memory. A Codex connector sign-in is separate. Missing GitHub access does not disable local Git or code tools. The curated tools do not commit, push, merge or publish, and they do not invoke another LLM; their returned evidence still contributes to the model's context.

## Test and package

```powershell
npm.cmd test
npm.cmd run package:windows
```

Packaging prints the staged executable, portable ZIP, version, file count and archive SHA-256. Unzip the entire archive and run `AI Deck.exe`. Recipients configure their own CLIs; packaging does not embed `AI_DECK_CODEX_EXE` or `AI_DECK_CLAUDE_EXE` overrides. The application payload includes `release-manifest.json` with relative paths and file hashes, without profile or account data.

Voice transcription is optional. To enable it from source or bundle it into the ZIP, set `AI_DECK_VOICE_DIR` to a folder with the Windows Whisper binaries and license in `whisper/` and `ggml-base-q5_1.bin` in `models/`.

After publishing a successful package, cleanup retains the latest three release versions, including their ZIPs and one completed stage per version. Active builds and running staged apps are preserved, and locked cleanup is retried after a later successful package. `--keep-stage` retains the completed QA stage while still respecting this release limit.
