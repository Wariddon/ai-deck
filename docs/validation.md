## 0.9.151 native drafts and window sharing

- Fixed delayed native file imports overwriting the saved text or attachment list after leaving and reopening a chat. Imports now merge the latest record, notify the current editor and preserve newer draft edit versions. Empty revision retention no longer evicts unsent file drafts. Ordinary typing performs no attachment-ledger writes unless it must invalidate a pending receipt once.
- Fixed native window leases surviving minimize/hide when the selected project task was idle. All run-pool window shares now close; restoring the app does not renew them. Stop sharing targets the exact original-chat request and remains separate from stopping the model. Native status is restored when reopening a running chat.
- Fixed Codex Chat only filtering out the explicitly shared window MCP. The approved bridge remains available while shell, subagents and unrelated MCP tools stay disabled. No additional model calls classify these actions.
- Fixed binary and invalid-text reads not counting toward the file-search disk budget. Searches stop within the byte limit and mark incomplete results.
- Validation: build passed; all 307 local tests passed serially (62.345s). Isolated desktop fixtures cover both providers, late extraction, reopening drafts, shared-window revocation, wrong request IDs, source-chat IDs, duplicate sends and restart restoration. The same lifecycle and attachment fixtures passed against the packaged main/preload/renderer. OS controls and providers are mocked in these fixtures.
- Real provider probe: Codex gpt-6.1-sol low called the allowed window screenshot MCP once and answered Red (12.970s, 33,832 reported tokens). Claude sonnet low did likewise (5.798s, 7,207 reported tokens). The MCP returned a controlled synthetic red image; this verifies real model/tool wiring, not arbitrary applications or complete desktop control. Token totals include provider context and internal model rounds; this is not a model speed or cost comparison.
- Public source review excludes local auth, executable defaults, runtime profiles, transcripts, generated images and archives. No dependency changes were required. Native cloud workspaces, account-memory synchronization, arbitrary coordinate dragging and simultaneous multi-window control remain outside this bridge.

## 0.9.150 local capabilities

Validation: build passed; all 302 tests passed with `node --test --test-concurrency=1 tests/*.test.*` (55.457s). Packaged main/preload/renderer attachment and restart fixture passed with isolated OS/provider mocks. Installed at C:/AIDeck after verifying all 1,287 package files and unchanged user profile. Existing three task IDs, histories and queued-message counts stayed unchanged. Installed UI opened successfully; both Codex and Claude Recents loaded their original chats and exposed Files & images, Screenshot and Share a window in one compact paperclip menu.

- Original Codex/Claude Recents: same native IDs, image/text document imports, thumbnails, saved attachment receipts, duplicate request rejection, screenshot preview and one-turn window MCP. Per-chat file drafts and saved transcript attachments are checked across full app restart. OS window enumeration/control is mocked in the automated desktop fixture; this is not proof of every Windows application's accessibility behavior.
- Review tools: real numbered source reads, bounded literal search, no Git requirement for reads, exclusion of sensitive/generated/external/linked/binary paths and abort support. Evidence output is valid bounded JSON rather than an arbitrary cut through JSON.
- Claude one-shot reviewer previously lost image bytes. Structured image input fixes it without enabling shell or file writes. Native shared-window turns explicitly retain source-chat persistence; writer file permissions remain separate from UI approval.
- Live CLI probe (isolated folder, no user source edits): Codex gpt-6.1-sol low and Claude sonnet low both called file_search and file_read, returned `width + 7` at app.ts:1, read ORCHID-427 from attached text, and recognized a red attached image. Codex: 39.543s, 84,283 reported tokens (66,048 cached input); Claude: 10.110s, 13,734 reported tokens. These are provider-reported totals including internal tool rounds and provider context, not a performance comparison or a claim of token savings.
- Scope: one shared window and one controller at a time. Accessible invoke/set/scroll/navigation are supported. Arbitrary coordinate dragging, provider-native cloud/remote workspaces, native browser/plugin marketplaces and private account memory APIs remain outside the local bridge. Voice remains transcription/chat/TTS, not native realtime voice.

# AI Deck 0.9.149 validation

## Chat and update regression audit

- All 294 automated tests passed. The final packaged native-chat fixture also verified the waiting clock and exact Low RAM reason, with three controlled Codex calls and zero calls to the cancelled waiting Claude provider.
- Reproduced a queued original-chat status that said Working instead of showing the Low RAM wait reason. The renderer used a UI selection key to look up a run-pool job. Backend, composer and Recents now share the native job key, with a waiting clock and actual reason for unstarted chats.
- Reproduced a restored-draft tracking edge case: after many other chats evicted the tracking entry, two absent edit tokens could compare equal. Every send now receives a real draft edit token, so a late reply cannot clear a newer identical draft after eviction.
- Reproduced old latest-channel Claude update evidence surviving a failed stable-channel check. A channel change now invalidates incompatible cached release evidence. Desktop records no longer acquire a CLI release channel after restart, and expired snapshots are marked Last known.
- An idle snapshot of the installed baseline showed no unfinished saved runs or enabled schedules, four app processes using about 340 MB combined working set, and 0.0 CPU seconds across a three-second sample. This is a short idle observation, not a load benchmark or leak proof.
- Controlled native-chat integration checks preserve the original IDs and drafts, show the queued wait reason, and cancel the waiting provider without calling it. Metadata outages and draft-eviction cases are deterministic tests; no user conversation is sent by this audit.
- Installed 0.9.149 at `C:\AIDeck`, verified installed/ZIP module hashes, and opened the original workspace. All three saved tasks retained identical histories, drafts and hidden-note markers, with no extra task. Available physical RAM measured about 0.72 GB of 7.79 GB during the audit; whole-machine memory pressure remains a possible source of delays beyond these fixes.

## Nonblocking saved-plan notes

- All 291 automated tests passed, including the full restart and two-provider conversation regression.
- Earlier blocked or incomplete plans appear as quiet notes explicitly stating that chat can continue. The existing related-chat link opens the same continuation; no new task is created.
- Hiding a note is scoped to the selected chat and latest finished non-ready plan. It persists across a full process restart, removes that run's sidebar attention, and does not replace the note with a duplicate Auto Team warning. New plan IDs can show their own notes.
- Drafts, recorded plan state, evidence, permissions and checkout validation remain unchanged. A ready approval or running plan cannot be hidden with this action.
- The isolated desktop fixture uses the production renderer/preload/backend, opens the existing continuation and returns, preserves both drafts, hides the note, and restarts. It then completes one tool-free Codex/Claude exchange in the same chat with local provider fixtures, without applying the old plan or creating a worktree. These are controlled provider tests, not live model calls.
- Installed 0.9.148 at `C:\AIDeck` with the profile unchanged during replacement. Opened the user's original AI-ideapad chat and hid its earlier plan note. Both original and project_bot drafts and run-history hashes remained identical (2 and 7 runs respectively); no real provider message was sent and no continuation was created.

## Provider update bell

- All 288 automated tests passed, including the isolated desktop integration and full restart checks.
- Version comparison covers Codex prereleases, Claude release channels and Windows four-part versions. Windows package parsing requires an exact product ID and an actual newer Available version.
- Metadata checks use read-only `winget list` and public publisher npm dist-tags, with bounded processes, response sizes, timeouts and cancellation. They never install software, accept source agreements, authenticate, or send model prompts. Checks yield to foreground work and successful results are cached for six hours; partial failures retry after fifteen minutes.
- Each actual check rereads the configured binary version. An observed completed upgrade invalidates an old update alert even if the remote catalog is offline; locally observed versions remain visible during network failures.
- Windows Package Manager discovery allows its fixed per-user App Execution Alias when Windows denies file stat, without using that fallback for Codex or Claude executables. Invalid older update-cache values do not block startup.
- The isolated Electron fixture exercises the production renderer, preload and backend at 1240×800 and 760×540, verifies fixed update links, rejects arbitrary links, and checks read status across a full process restart. Provider model calls and external navigation are replaced only in the fixture.
- A live metadata check on this Windows machine took about 4.7 seconds and reported Codex CLI 0.167.0-alpha.3.2 → 0.167.1 and Claude Code 2.1.319 → 2.1.322. Windows reported installed Desktop versions but no Available version. This is catalog evidence, not proof that every provider distribution channel is current. No models were called or providers updated.
- Installed 0.9.147 at `C:\AIDeck` with the existing profile unchanged during the file replacement. Opened the actual bell and clicked Check now: both Desktop installed versions appeared after the alias fix, the two CLI updates remained unread, and no chat was sent. Source, installed modules and ZIP module hashes matched. Provider applications were not upgraded.

## Native chat navigation and draft delivery

- All 278 automated tests passed. The desktop regression fixture covers opening a read-only source then the same chat from Recents, navigating away during a delayed reply, and reopening a waiting chat to stop it.
- Native delivery uses the shared provider/session key, observed message IDs and draft edit versions. A verified sent draft is cleared on return; a newly typed identical follow-up stays visible and autosaved.
- Reopening restores the exact pending request and its controls. Cancelling before the model starts releases the composer and retains the draft while another chat continues.
- Incomplete legacy replan attachment records no longer crash link discovery or infer a destination.
- Bounded real Codex and Claude continuations passed in isolated native conversations, retaining IDs with one call per provider. The navigation race checks use controlled providers so timing and cancellation are repeatable without additional model calls.

## Replanned chat navigation (0.9.145 baseline)

- All 272 automated tests passed. Explicit source IDs retain the relation after renaming; legacy inference requires exact saved plan context, native source and attachment matches. Ambiguous matches and archived destinations are excluded.
- A controlled desktop check on the production renderer, preload and backend opened an existing related chat, preserved both drafts and the old blocked plan, and created no extra task or model call. Plan options retained all four actions and the banner fitted normal and compact windows.
- Existing local records were checked read-only: the old AI-ideapad task has a related project_bot chat derived from an earlier blocked planning round. This link does not mark the latest old plan as passed or establish deployment status.

## Chat concurrency and draft regression (0.9.144 baseline)

- All 267 automated tests passed, including an offscreen Windows integration fixture using the real renderer, preload and backend with local simulated providers.
- A delayed model list no longer blocks opening another original chat. Concurrent readers share one metadata request; failed reads can retry, and reconnecting invalidates cached capabilities and old in-flight results.
- Delaying a completed native-send response no longer clears a newer draft. The completed response does not include its own pending-job marker.
- Waiting native jobs reject model and permission changes. Stopping a waiting job leaves the other job running and makes no model call for the cancelled chat.
- Parallel real Codex and Claude model-catalog reads and one continuation per provider passed in isolated existing conversations. Both kept their native IDs, saved each message once and returned an idle chat after completion. Temporary authentication copies were removed.

## Original-chat model controls (0.9.143 baseline)

- All 266 automated tests and the production renderer build passed on Windows x64 with Node.js 24.
- Packaged UI fixtures changed Model, Effort and Speed for both providers, preserved drafts and permissions, resumed the same native IDs, and saved each new message once. Full process restart restored both chats' selections and drafts.
- Existing isolated Codex and Claude conversations received one real continuation each with explicit models, Low effort and Standard speed. Both completed and retained their original native IDs. Model metadata reads did not send model prompts.
- Fast support was checked through catalog capabilities, runner contracts and controlled UI fixtures; these live calls used Standard speed.
- Claude model-list initialization tolerates a cold start and returns as soon as structured metadata arrives, with bounded CLI cleanup afterward.

The concurrency and editing integration observations below were recorded for 0.9.142. The current automated suite also covers those paths.

## Automated checks

- Production renderer build and Sites bundle preparation passed.
- First-use Electron preparation runs once before application startup or parallel test workers, preventing competing runtime downloads in a fresh clone.
- Checks cover native chat continuity and permissions, queued follow-ups, run recovery, document attachments and OCR, usage reporting, Git worktree checks and shared review evidence.
- Concurrency checks cover independent job scopes, the two-job limit, Low RAM and memory waits, duplicate submission rejection, shared native-session and folder leases, cancellation during preparation, and a short Git worktree preparation mutex.
- Per-run checkpoints preserve another job's evidence when one job finishes. Waiting project jobs recover once as paused messages while preserving a newer draft.

## Desktop integration checks

Controlled provider fixtures exercised the packaged renderer, preload and backend together:

- Two jobs overlap and a third waits for capacity.
- Sidebar activity rings appear for both running chats.
- Switching chats preserves each transcript, partial reply and pending approval.
- Identical approval keys in different jobs route to the correct provider.
- Stopping one job leaves its peer running and releases capacity for a waiting job.
- A follow-up starts in its own chat even while a different chat is selected.
- A failed queued original-chat request does not clear another chat's working state.

These fixtures simulate provider timing and errors. They do not establish live model behavior by themselves.

## Live provider smoke checks

Separate isolated profiles were used for bounded Codex and Claude calls:

- Independent tool-free chats overlapped, made one call per provider and kept their answers separate.
- Existing original-chat fixtures overlapped, retained their native conversation IDs and saved each new user message exactly once. Pending turns could be reopened while they were still working.
- Two editing jobs in the same fixture repository created separate worktrees. Codex and Claude each wrote only the requested marker file in their own checkout, with one call per provider. The original checkout remained unchanged.

Temporary authentication copies were removed after these checks. No user business chat or repository was used as the live test target.

## Performance observations and limits

Claude Recents caches up to 160 unchanged metadata records without retaining open file handles or complete transcripts. In one local 40-session sample, warm listings took about 5–6 ms with no transcript metadata file opens, compared with about 90–180 ms and 40 opens before caching. These are listing measurements, not a guarantee about application startup or inference speed.

Automatic quota and Recents refreshes wait for a brief input-idle interval. A renderer fixture observed zero automatic quota reads during typing and both reads after the pause. Explicit refreshes remain immediate. No model call is added for this scheduling behavior.

Live checks establish the exercised orchestration and isolation paths. They do not establish an unlimited concurrency level, safe concurrent writes to one checkout, availability on every subscription plan, or that all possible UI latency has been eliminated. Provider quotas and machine resources still apply.
