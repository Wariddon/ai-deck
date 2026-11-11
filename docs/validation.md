# AI Deck 0.9.142 validation

## Automated checks

- Production renderer build and Sites bundle preparation passed.
- All 259 automated tests passed on Windows x64 with Node.js 24.
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
