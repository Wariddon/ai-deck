## 0.9.162 native chat rendering and live plan updates

- Memoized the loaded native transcript independently of composer edits and activity controls, with a stable attachment-preview callback. Filtering is invalidated by messages or search text, not every draft keystroke. Existing Markdown controls, search, previews and provider/session draft ownership remain available. Native command details now mount only when opened.
- Reproduced an activity retention bug: after unkeyed events filled the eighty-step list, the fallback key reused the list length and overwrote its final entry. A separate monotonic sequence now preserves the most recent eighty steps, including after serialization; keyed tool updates still replace the matching entry.
- Published native Session Team planner metadata immediately after parsing its final report so the current chat can show the saved contract while the builder is still working. Controlled tests hold the downstream builder and check both native planner orders without adding provider calls.
- An isolated 480-message renderer probe on installed 0.9.161 observed 26 transcript passes over 12,480 items while typing twelve draft updates. The updated renderer checks that typing does not walk the loaded transcript, then exercises word wrap, search, lazy command details and switching away/back with the draft intact. These probes simulate providers and do not establish live Claude behavior or a whole-app latency improvement.
- Production build and all 350 serial tests passed. The final package repeated 12 team cases with 24 simulated provider calls, two live planner-to-builder checks, and a full application restart without replay. Its 480-message typing probe recorded zero transcript passes/items and zero provider calls. A three-second idle observation of the previous installed app found no CPU activity in its four processes; the saved workspace had no unfinished runs or queued messages. This is a bounded observation, not a general idle-load guarantee.
- Installed 0.9.162 to `C:\AIDeck`, hash-verified all 1,289 application files, and reopened the app. The five existing tasks, workspace data, saved model/permission choices, preferences and pins matched the pre-update snapshot. Low RAM remained off, close-to-tray stayed on, and no unfinished runs, queued messages or main-process exceptions were observed. Live Claude testing remains skipped at the user's request.

## 0.9.161 plan inputs, outputs and handoff conditions

- Existing Auto Team assignments and paired project plans now preserve bounded `inputs`, `outputs` and `readyWhen` lists. They reach builders, independent reviewers, scoped repairs, rechecks and final integration in the existing provider turns. Legacy prose and saved assignments without these fields remain usable. Malformed supplied fields are surfaced rather than silently dropped from a ready plan.
- Native Session Team planners return the same contract in their current report. The app stores it under that member and forwards it independently of the bounded report excerpt, through the existing sharing filter. It renders the final plan as Markdown; no extra setup button, background job, model call or executable check is created from a condition string. Ordinary builder/reviewer handoffs use the shared guidance without requiring a planning round.
- Approval snapshots now bind the plan text, assignments and conditions as well as the checkout and effective setup. Auto Team executes a copy while its original plan retains implementation status. Conditions remain requirements for agents to inspect against the supplied artifacts and observed evidence, not deterministic checks or proof inferred from a completed provider turn.
- Visual package QA exposed raw paired-plan protocol JSON in the chat. Timeline and Split now render the saved plan and contract, hide partial protocol streams and avoid duplicating native Session Team planners' formatted final replies. Raw provider messages remain in diagnostics.
- Controlled desktop coverage includes both paired planner/writer orders and native Session Team planner/writer orders, a contract longer than the handoff excerpt, a changed condition after an approval preview, per-task isolation and an actual application restart preserving plans/native IDs without replaying turns. Providers are simulated. Live Claude testing remains skipped at the user's request.
- Production build, skill validation and all 348 serial tests passed. The final package passed 12 controlled scenarios with 24 simulated provider calls and a separate application restart with no replay. Verified the corrected plan rendering visually, installed 0.9.161 to `C:\AIDeck` with all 1,289 application files hash-matched, and reopened it. The five existing tasks, workspace data, saved model/permission choices and preferences matched the pre-test snapshot; no unfinished runs or queued messages were present. This does not establish live Claude behavior or a whole-app latency benchmark.

## 0.9.160 shared planning and targeted review skills

- Extended the bundled `ai-deck-team-review` with scoped planning/handoff guidance adapted from Superpowers Writing Plans and test-quality/failure-visibility guidance adapted from Anthropic PR Review Toolkit. Source links, modification notes and the upstream MIT/Apache-2.0 license texts are included in the distributed skill. No remote plugin or additional orchestrator is installed at runtime.
- The assigned planner and builder use the shared-work sections; reviewers receive the test guide for code changes and the failure guide for changed error paths. Doc-only changes omit both specialized reviewers' instructions. Evidence requests and repairs retain their narrow existing guidance. Standalone work and ordinary conversation do not gain team-planning steps. This is bounded prompt guidance for existing members, not additional model calls.
- Fixed Session Team missing the shared guidance and usage recording that standard team runs already received. Record usage under the matching standard, Auto Team or Session Team run, merging repeated stages without duplicate skill names. Preserve explicit opt-outs in normalized Session Team and planning drafts. Queued setups and held review evidence include the full conditional-guide fingerprint so a guide update cannot silently alter an already saved setup.
- Controlled desktop coverage swaps Codex/Claude builder and reviewer roles in standard and Session Team workflows, checks Auto Team planning, doc-only filtering, and opt-outs. These providers are simulated; this verifies routing, snapshots and turn counts, not a live model-quality or token-saving benchmark. Live Claude testing remains skipped at the user's request.
- Production build, skill validation and all 342 serial tests passed. The final package passed eight controlled scenarios with 16 simulated provider calls, two per scenario. Installed 0.9.160 to `C:\AIDeck`, verified all 1,296 application files and an unchanged user profile during replacement, and reopened the existing workspace. The installed planner/reviewer guides and bundled license files were checked directly; no original chat received a test prompt.

## 0.9.159 chat isolation and draft persistence

- Fixed silent loss of original-chat drafts: loading and writing the text-draft list previously retained only the last 16 nonempty chats. All unsent text is now retained. Malformed individual saved rows no longer erase unrelated valid drafts. Confirmed source-chat deletion persists removal of only that chat's text draft.
- Text edits update the in-memory draft immediately and coalesce disk writes within 200 ms. Navigation, sending, clearing a delivered draft and window checkpoints flush synchronously. Failed storage writes retain in-memory text and show an actionable error instead of failing silently. This change reduces input-handler work without any model calls or new controls.
- Controlled production renderer/backend tests use two Codex conversations and one Claude conversation, including an identical native ID on different providers. They verify distinct Model / Effort / Speed values reach the correct runner, double-submit produces one send, a delayed reply cannot clear another chat's identical draft, a delayed model-save reply cannot replace the newly selected chat's settings, and full process restart restores choices and drafts without replay. Two separate AI Deck task drafts and task model overrides also remain distinct.
- The desktop fixture preserves 20 preexisting unsent native drafts across edits and restart. A burst of 60 input events produces one text-draft storage write. Unit checks cover 40 unsent drafts, storage quota failure/retry, delivery clears and invalid saved rows. Both providers are simulated; no live Claude or Codex model request is made in this round, and Fast is exercised only in the fixture.
- Before the update, the open installed 0.9.158 processes used 297.5 MiB of summed working set and added 0.0 CPU seconds over a 2.074 s idle sample. The saved profile contained five tasks and no unfinished recorded run. This short idle observation does not establish peak memory or workload performance.
- Build and all 338 serial tests passed. Repeated both phases against packaged 0.9.159: three simulated sends, zero sends on restart, all 20 legacy drafts preserved, and one write for the 60-event typing burst. Closed the idle installed app through its normal Quit action, verified all 1,291 replacement files and an unchanged profile during installation, then reopened `C:\AIDeck`. The original task and history remained visible; no real provider prompt was sent.

## 0.9.158 live model settings and expired sign-in

- A known terminal provider authentication failure now changes the connection to Sign-in needed, retains the CLI's reconnect command and explains that AI Deck will not resend automatically. Connections also offers Sign in again when the CLI still reports stored credentials. Model metadata reads cannot silently replace that failure with a local stored-token check. Explicit reconnection still checks the native CLI; startup does not spend a model request testing credentials. Assistant quotes, tool permissions, usage limits and transport failures do not count as expired sign-in.
- Live Codex verification against installed 0.9.157: explicitly selected GPT-6.1-Sol / Low / Standard in the project composer and original-chat picker. The actual protocol sent that model and effort with the default service tier. The first request completed in 4.006 s and continuation after process restart in 4.677 s, excluding application startup and metadata reads. Both used the same native ID, the follow-up recalled the original code, and each user message was recorded once. No duplicate AI Deck task or provider chat was created. Project and original-chat settings and unsent drafts restored.
- Live Claude attempt sent Sonnet / Low / Standard (`fastMode: false`) to its real CLI, but failed in 1.868 s with `OAuth session expired and could not be refreshed`. This is not a successful model response or proof of the effective remote model. A new sign-in is required before completing Claude's live continuation test. Claude's saved project selections and unsent draft survived a separate full restart into the updated source. Fast was not enabled or live-tested.
- The live fixture used an isolated AI Deck profile and Git project, with temporary credential copies removed after each process. The user's original tasks, drafts, provider chats and credentials were not modified by these sends. Separate controlled desktop fixtures verify the expired-login state, no automatic retry, continued Codex availability, model-read guard and next-draft persistence in both project and no-project chat. Those failure-path fixtures use simulated providers.
- Production build and all 333 serial tests passed. The UI fixture renders offscreen so screenshot checks do not depend on an interactive Windows compositor surface.
- Both controlled flows passed again against the final packaged renderer/backend, including launching sign-in from stored Signed in and expired-login states without opening a real authentication terminal. Installed to `C:\AIDeck` with all 1,291 application files verified and an unchanged user profile during replacement. Rechecked saved selections/drafts and the existing live Codex conversation through the installed code without another provider send. Claude's successful live reply remains pending authentication.

## 0.9.157 solo model menu

- Fixed the empty Run options popover in solo project workflows such as Claude Edit and Codex. The menu now exposes the requested provider's model controls; team workflows include both providers, and one-provider no-Git forks show their chosen provider.
- The desktop fixture opens the menu, verifies the provider buttons, loads each model catalog and saves Model, Effort and Speed for the current task. The unsent text and permission mode remain unchanged, and opening/saving controls sends no model prompt. Native HTML dialogs are checked through their actual open state.
- Build and all 331 serial tests passed. Repeated the extended fixture against the packaged renderer/preload/backend with and without a Git project. Provider behavior is simulated for these checks; this is UI and settings-path evidence, not a live model-response benchmark.
- Installed 0.9.157 at `C:\AIDeck` after a normal Quit, verifying all 1,290 package files and an unchanged profile during replacement. Reopened the existing solo Claude fork and clicked its formerly empty menu: it showed the provider button, and the signed-in native catalog loaded Opus 5.5 with active Model, Effort and Speed controls. Closed the settings dialog without saving and left the corrected menu visible. No message was submitted.

## 0.9.156 one-click chat forks

- Fork to Team, Fork to Codex and Fork to Claude open the composer directly from both original-chat actions and Recents menus. No setup dialog, initial message, provider turn or source-transcript mutation is made by creating a fork. The backend reads up to six recent complete saved messages within a 6,000-character text budget, preserves their attribution and treats them as quoted history.
- Automatically prefer a verified source Git project, otherwise the current verified project. The saved target is rechecked before project work. Project forks start at Ask for approval, expose the existing permission picker and retain the recipient after sending. A missing project leaves a no-Git conversation available, with file-tool limitations explained rather than inventing a verified destination.
- Build and all 331 serial tests passed. The production renderer/preload/backend fixture checks both source providers and all three targets, including double-click suppression, unchanged original transcripts and drafts, correct project choice, solo follow-ups and no-project conversation. Additional UI checks select Full access, Approve for me and Ask for approval through the actual picker and verify saved values; normal/compact layouts stay within the viewport. Providers in this fixture are controlled local implementations, not live model calls.
- Repeated all six fork combinations against the packaged application with and without a project. Installed 0.9.156 at `C:\AIDeck` after verifying all 1,290 file hashes and an unchanged profile during replacement. Kept the previous 0.9.155 application as a rollback copy. No test message was sent to the user's original conversations.

## 0.9.155 chat-focused navigation

- Removed local Scheduled from navigation, its renderer, public IPC commands and startup timer. Legacy schedules restore paused with no next run; their saved history remains. Chat, Usage and Settings remain in the primary rail.
- Reduced Settings from 23 entries to 13: archives stay in Recents, billing stays in Usage, screen/window/browser tools share one page, Git and worktrees share one page, shortcuts are in General and import/configuration/storage/privacy are grouped in Advanced. Existing internal settings links retain their working destinations and sidebar grouping.
- Build and all 329 serial tests passed. Isolated Electron QA opened all 13 Settings pages, verified a seeded due legacy schedule stayed paused past the former five-second tick, and checked that schedule IPC is absent. Zero model calls. The composer and direction menu also passed at 1240, 900 and 760 px; Settings passed normal/compact width checks.
- The same QA passed against the packaged renderer/backend. Installed to `C:\AIDeck` with all 1,290 file hashes verified and an unchanged profile during the copy; the three existing tasks and Low RAM preference were preserved.

## 0.9.154 compact composer direction

- Moved the existing Codex → Claude / Claude → Codex / discussion picker into the composer toolbar beside Permissions. Removed its separate footer row and hide empty hint rows. Workflow availability and saved/queued settings are unchanged.
- Build passed, along with the six existing direction/layout tests. Isolated Electron visual QA at 1240, 900 and 760 px confirmed the picker stays inside the composer, Send does not overlap it, no horizontal page overflow appears and the menu fits the viewport. Switching to Claude-first persisted and kept the unsent draft, with zero model calls.

## 0.9.153 session names, activity and question times

- Rename is first in each session's compact ellipsis menu; F2 opens it for a focused sidebar row. Original chats also expose Rename in Chat actions. Source-provider names and AI Deck task names keep their existing scopes. New persistent chats use native Codex name metadata or Claude Code's `--name`; resumed and transient turns do not receive an automatic name override. Naming adds no model request.
- Native job snapshots expose only the currently executing member's provider/session ID. Both that Recents row and its team task show a loading ring. Resource queues and approval/question waits have separate icons. Completed turns clear their active references. These indicators track jobs owned by AI Deck; they do not claim to monitor every external Claude Desktop conversation.
- Team and original-chat user turns show their recorded question time. Date labels appear at day boundaries and full local dates are available on hover. Missing source timestamps remain unknown rather than receiving invented dates.
- `npm run build` and 329 serial tests passed. Isolated desktop fixtures rename both source providers, refresh the persisted name, preserve the native ID and draft, check recorded `<time>` values, observe the in-flight ring and verify it clears without another model call. The fixture restores its saved chat and attachments after a full restart. Provider interactions in this fixture are simulated.
- Repeated the desktop fixture against the packaged 0.9.153 renderer/backend: all six checks and the restart passed with four simulated sends total; renaming caused no extra sends. Installed to `C:\AIDeck`, verified hashes for all 1,290 application files and an unchanged profile during installation. Reopened the installed app and visually verified the compact Rename menu and recorded times in an existing original Codex chat. Three existing tasks and the user's parallel/Low RAM preference were preserved. No original conversation was renamed or sent a test message.
- Includes the previously uninstalled 0.9.152 native bridge work: on-demand Claude in Chrome, bounded read-only Codex Cloud CLI access and safe local-memory preferences. The live CLI check read an empty Codex Cloud list. A real Sonnet low Chrome check completed in 8.274 s with one AI Deck model send and 30,475 reported tokens (27,683 cached input); `list_connected_browsers` returned no connected browser. This proves native tool access, not successful live browser actions. Ordinary chat does not load these Chrome tools. No private web/account memory is mirrored.

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
