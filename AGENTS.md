# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

AI Deck uses the selected light Parallel Desk design with side-by-side Codex and Claude activity. The prototype demonstrates shared knowledge from both providers, shared skills and settings, and workspace plugin management with simulated agents.

The interactive sandbox should feel like a coding session. Keep user turns and the two agent activity feeds, show file reads and reviewable edits, and derive sandbox check results from the edited workspace.

The Electron desktop app uses the Codex-style navigation rail with project/task search, a shared Timeline or Split view, and the Changes, Usage and Context inspector. Scheduled runs stay in a separate view with their own history and fresh worktrees. Feature map distinguishes the connected desktop actions from features opened in the provider's app.

Keep the desktop interface compact. Use a smaller default window and tight spacing across navigation, chat, forms, and the inspector while keeping labels readable and controls easy to click.
Keep the compact defaults at 100% and save UI scale and text size separately in the desktop profile.
Keep model and effort controls for both agents visible in the desktop composer. They must be usable before a repository is opened and apply through each provider's runner.
Usage keeps provider quota resets and credits separate from clearing an AI Deck hold and from per-session cost estimates. Using an earned reset requires an explicit user action.
Keep Settings organized by category and use the full work area for main menu pages. Project navigation and the chat inspector can be opened as needed.
Show each agent’s role and workflow order before a team run. A saved or queued team brief must reach the runner, and sequential handoffs should be visible in the timeline. Shared skills are explicit context, while composer slash commands dispatch only supported AI Deck actions.
Distinguish review evidence and command outcomes from model completion. Worktree base updates create a verified copy and preserve the source task and its staging.

Team planning starts a read-only planner and saves its decision. Implementation always requires a separate user approval, including for scheduled plans. Earlier ready plans remain accessible within the retained task history.
Queued messages keep their team brief and pause for review when the effective model settings, shared context, or project permissions change. Combining selected files from parallel worktrees creates a separate task only after verifying both source snapshots.

Team inbox lists plans, reviews, usage handoffs and paused queues across projects. Keep unresolved ready plans beyond recent run retention until implemented or dismissed.
The local skill library saves explicit snapshots. A project keeps its installed version and enabled preference until the user previews and updates that copy.

Steer preserves the active single-agent mode and setup. Saved plan approval compares current Git and effective writer settings to the planning snapshot. Writer completion and observed Git changes remain separate from the user's implementation decision.
When a schedule is held before starting for usage, retain one occurrence across app restarts. Resume the same occurrence on an enabled schedule without replaying additional missed slots.

The Inspector defaults to a compact task Outputs tab with previews, observed running processes, and sources. Keep the panel task-scoped and collapsible.

The Team Plan board keeps responsibility text with the role when swapping Codex and Claude. Save role defaults per task. The active run and already queued messages retain their own assignments.

A Team Plan one-message override is consumed when the user sends or queues the draft. History and queued role details show recorded assignments. Usage handoff moves the original writer's responsibilities to the replacement. Role presets save workflow and written role text locally.
