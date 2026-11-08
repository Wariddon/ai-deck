import { useState } from "react";
import {
  IconBook, IconChartBar, IconClock, IconExternalLink, IconGitPullRequest,
  IconHome2, IconInbox, IconLayoutGrid, IconPuzzle, IconSettings,
} from "@tabler/icons-react";
import { agentNames, modeLabel, projectName } from "./TeamThread.jsx";
import { activeUsageLimit } from "../desktop/usage-routing.mjs";
import { planResultCanBeConfirmed } from "../desktop/collaboration.mjs";

const pages = [
  ["workspace", "Workspace", IconHome2],
  ["inbox", "Team inbox", IconInbox],
  ["scheduled", "Scheduled", IconClock],
  ["changes", "Git & Review", IconGitPullRequest],
  ["context", "Knowledge", IconBook],
  ["plugins", "Skills & Plugins", IconPuzzle],
  ["usage", "Usage", IconChartBar],
  ["features", "Feature map", IconLayoutGrid],
  ["settings", "Settings", IconSettings],
];

export function DeckNav({ current, go }) {
  return <nav className="deck-nav" aria-label="AI Deck">
    {pages.map(([key, label, Icon]) => <button type="button" className="icon-button" key={key} aria-label={label}
      title={label} aria-current={current === key ? "page" : undefined} onClick={() => go(key)}><Icon size={19} /></button>)}
  </nav>;
}

export function WorkbenchPage({ title, description, scope, actions, children, hidden = false }) {
  return <section className="deck-page deck-workbench" aria-label={title} hidden={hidden}>
    <header className="deck-page-heading">
      <div>{scope && <p className="deck-kicker">{scope}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="thread-actions deck-page-actions">{actions}</div>}
    </header>
    {children}
  </section>;
}

const inboxFilters = {
  all: ["All"],
  plans: ["Plans", "approval", "plan-input"],
  reviews: ["Reviews", "review"],
  handoffs: ["Usage handoffs", "usage"],
  queued: ["Paused queues", "queue"],
};

function inboxLabel(row) {
  if (row.kind === "plan-input") return ({ "needs-input": "Plan needs your input", unclassified: "Plan needs revision", blocked: "Plan blocked" })[row.planState];
  if (row.kind === "approval" && planResultCanBeConfirmed(row.applyStatus)) return "Implementation needs review";
  return ({ approval: "Plan awaits approval", review: "Review pending", usage: "Usage handoff available", queue: "Queue paused" })[row.kind];
}

export function TeamInbox({ rows, loading, error, busy, connections, now, refresh, open }) {
  const [filter, setFilter] = useState("all");
  const [repo, setRepo] = useState("");
  const projects = [...new Set(rows.map((row) => row.repo))];
  const selectedRepo = projects.includes(repo) ? repo : "";
  const entries = rows.filter((row) => !selectedRepo || row.repo === selectedRepo);
  const visible = entries.filter((row) => filter === "all" || inboxFilters[filter].includes(row.kind));
  return <WorkbenchPage title="Team inbox" scope="All projects" description="Review saved plans, pending reviews, usage handoffs and paused queues."
    actions={<button className="button small" disabled={loading} onClick={refresh}>Refresh</button>}>
    <div className="thread-actions deck-inbox-filters">
      <nav className="deck-settings-tabs" aria-label="Team inbox filters">
        {Object.entries(inboxFilters).map(([key, [label, ...kinds]]) => <button key={key} aria-current={filter === key ? "page" : undefined}
          onClick={() => setFilter(key)}>{label} · {key === "all" ? entries.length : entries.filter((row) => kinds.includes(row.kind)).length}</button>)}
      </nav>
      {projects.length > 1 && <select aria-label="Filter inbox by project" value={selectedRepo} onChange={(event) => setRepo(event.target.value)}>
        <option value="">All projects</option>
        {projects.map((path) => <option key={path} value={path}>{projectName(path)}</option>)}
      </select>}
    </div>
    {error && <p className="live-error" role="alert">{error}</p>}
    {loading && !rows.length && <p role="status">Checking team tasks…</p>}
    {!loading && !visible.length && !error && <div className="deck-box"><h2>Nothing waiting here</h2>
      <p className="setting-detail">Tasks appear when they need a decision or have follow-up work.</p></div>}
    <div className="deck-inbox-list">
      {visible.map((row) => {
        const connection = connections[row.to];
        const hold = row.to && (activeUsageLimit(connection?.usageLimit, now) ? agentNames[row.to] + " is at a usage limit"
          : connection?.status !== "ready" ? agentNames[row.to] + " needs a connection" : "");
        const plan = row.kind === "approval" || row.kind === "plan-input";
        return <article className="deck-box" key={row.id}>
          <div className="deck-page-heading">
            <div><span className="deck-kicker">{inboxLabel(row)} · {projectName(row.repo)}</span><h2>{row.title}</h2></div>
            <button className="button small" disabled={busy} onClick={() => open(row)}>{plan ? "Open plan" : "Open task"}</button>
          </div>
          {row.prompt && row.prompt !== row.title && <p className="setting-detail">{row.prompt}</p>}
          <p className="setting-detail">{[row.from && agentNames[row.from], row.to && agentNames[row.to]].filter(Boolean).join(" → ")}
            {row.count && (row.count === 1 ? "1 queued message" : row.count + " queued messages")}
            {row.updatedAt && <time dateTime={row.updatedAt}> · {formatDate(row.updatedAt)}</time>}</p>
          {(row.unavailable || hold) && <p className="usage-hold">{row.unavailable || hold}</p>}
        </article>;
      })}
    </div>
  </WorkbenchPage>;
}

export function ProjectEmpty({ message, choose, busy }) {
  return <div className="deck-box deck-project-empty">
    <h2>Open a project</h2><p className="setting-detail">{message}</p>
    <button className="button primary" disabled={busy} onClick={choose}>Open repository</button>
  </div>;
}

const cadences = { daily: "Every day", weekdays: "Weekdays", weekly: "Weekly" };
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const scheduledModes = ["team", "build-review", "claude-plan-codex", "codex-plan-claude", "codex", "claude", "claude-write"];
const isPlanMode = (mode) => mode === "claude-plan-codex" || mode === "codex-plan-claude";
const localTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (value) => localTime.format(new Date(value));
const routeLabel = (schedule) => `${schedule.cadence === "weekly" ? days[schedule.day] : cadences[schedule.cadence]} · ${schedule.time}`;
const emptySchedule = { name: "", prompt: "", repo: "", mode: "team", cadence: "weekdays", time: "09:00", day: 1, access: "read", fallback: "wait" };

function ScheduleForm({ draft, setDraft, projects, save, cancel, busy, lowMemory }) {
  function change(event) {
    const { name, value } = event.target;
    setDraft({
      ...draft, [name]: name === "day" ? Number(value) : value,
      ...(name === "mode" && value === "claude-write" ? { access: "write" } : {}),
      ...(name === "mode" && isPlanMode(value) ? { access: "read" } : {}),
      ...(name === "mode" && !["team", "build-review"].includes(value) ? { fallback: "wait" } : {}),
    });
  }
  const field = (name) => ({ name, value: draft[name], onChange: change });
  return <form className="deck-box deck-schedule-form" onSubmit={(event) => { event.preventDefault(); save(draft); }}>
    <h2>{draft.id ? "Edit schedule" : "New schedule"}</h2>
    <label className="field"><strong>Name</strong><input required maxLength={90} {...field("name")} /></label>
    <label className="field"><strong>Task prompt</strong><textarea required rows={3} maxLength={18000} {...field("prompt")} /></label>
    <div className="deck-form-grid">
      <label className="field"><strong>Project</strong><select required {...field("repo")}>
        <option value="">Choose project</option>{projects.map(({ repo }) => <option key={repo} value={repo}>{projectName(repo)}</option>)}
      </select></label>
      <label className="field"><strong>Agent mode</strong><select {...field("mode")}>{scheduledModes.map((mode) =>
        <option key={mode} value={mode}>{modeLabel(mode, lowMemory)}</option>)}</select></label>
      <label className="field"><strong>Repeat</strong><select {...field("cadence")}>{Object.entries(cadences).map(([key, name]) =>
        <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="field"><strong>Local time</strong><input required type="time" {...field("time")} /></label>
      {draft.cadence === "weekly" && <label className="field"><strong>Day</strong><select {...field("day")}>
        {days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
      <label className="field"><strong>Permissions</strong><select {...field("access")} disabled={draft.mode === "claude-write" || isPlanMode(draft.mode)}>
        <option value="read">Read-only</option><option value="write">Edit in fresh worktree</option>
      </select></label>
      <label className="field"><strong>When usage is limited</strong><select {...field("fallback")} disabled={!["team", "build-review"].includes(draft.mode)}>
        <option value="wait">Hold this occurrence</option><option value="available">Run the available agent</option>
      </select></label>
    </div>
    {isPlanMode(draft.mode) && <p className="setting-detail">Only the planner starts on schedule. Open the resulting task to review the plan and approve implementation.</p>}
    <p className="setting-detail">Each run starts from the project's committed HEAD in a fresh worktree. New schedules start paused.</p>
    <div className="thread-actions"><button className="button primary small" disabled={busy}>Save schedule</button>
      <button className="button small" type="button" onClick={cancel}>Cancel</button></div>
  </form>;
}

export function Scheduled({ schedules, projects, workspace, background, busy, interactive, error, action, openTask, openProvider, openRepo, lowMemory }) {
  const [selection, setSelection] = useState(null);
  const [draft, setDraft] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const schedule = schedules.find((entry) => entry.id === selection) ?? schedules[0];
  const waiting = schedule?.runs.some((run) => run.status === "waiting for usage");
  const locked = busy || interactive || Boolean(background);
  const editor = draft && <ScheduleForm draft={draft} setDraft={setDraft} projects={projects} busy={locked} lowMemory={lowMemory} cancel={() => setDraft(null)}
    save={async (payload) => {
      const next = await action("save-schedule", payload);
      if (next) { setSelection(payload.id ?? next.schedules.at(-1)?.id); setDraft(null); }
    }} />;
  return <WorkbenchPage title="Scheduled" scope="AI Deck / Local" description="Run saved tasks while AI Deck is open."
    actions={<button className="button primary small" disabled={locked || !projects.length} onClick={() => {
        setConfirmRemove(false);
        setDraft({ ...emptySchedule, repo: workspace?.repo ?? projects[0]?.repo ?? "" });
      }}>New schedule</button>}>
    {error && <p className="live-error" role="alert">{error}</p>}
    {background && <p className="deck-status" role="status">Running · {background.name}
      <button className="button small" disabled={busy} onClick={() => action("stop")}>Stop scheduled run</button></p>}
    {!schedules.length && !draft && (projects.length
      ? <p className="thread-panel-empty">Create a schedule to run a saved prompt against a project.</p>
      : <ProjectEmpty message="Scheduled tasks run against a Git repository." choose={openRepo} busy={locked} />)}
    {schedules.length > 0 && <div className="deck-schedule-grid">
      <div className="deck-schedule-list">{schedules.map((entry) => <button type="button" key={entry.id} className="deck-schedule-choice"
        aria-pressed={schedule?.id === entry.id} onClick={() => { setSelection(entry.id); setConfirmRemove(false); setDraft(null); }}>
        <strong>{entry.name}</strong><span>{modeLabel(entry.mode, lowMemory)} · {routeLabel(entry)}</span><small>{entry.enabled ? "Enabled" : "Paused"}</small>
      </button>)}</div>
      {editor || schedule && <article className="deck-box">
        <div className="deck-page-heading"><div><h2>{schedule.name}</h2><p>{projectName(schedule.repo)} · {modeLabel(schedule.mode, lowMemory)}</p></div>
          <span className="source-pill">{schedule.enabled ? "Enabled" : "Paused"}</span></div>
        <dl className="deck-facts">
          <div><dt>Schedule</dt><dd>{routeLabel(schedule)}</dd></div>
          <div><dt>Next run</dt><dd>{schedule.nextAt ? formatDate(schedule.nextAt) : "Paused"}</dd></div>
          <div><dt>Permissions</dt><dd>{schedule.access === "read" ? "Read-only" : "Edit in fresh worktree"}</dd></div>
          <div><dt>At usage limit</dt><dd>{schedule.fallback === "wait" ? "Hold this occurrence" : "Run the available agent"}</dd></div>
        </dl>
        <div className="thread-actions">
          <button className="button small primary" disabled={locked} onClick={() => action("run-schedule", schedule.id)}>{waiting ? "Check usage & resume" : "Run now"}</button>
          <button className="button small" disabled={locked} onClick={() => action("toggle-schedule", schedule.id)}>{schedule.enabled ? "Pause" : "Enable"}</button>
          <button className="button small" disabled={locked || waiting} onClick={() => setDraft(schedule)}>Edit</button>
          <button className="button small" disabled={locked} onClick={() => setConfirmRemove(!confirmRemove)}>Remove</button>
        </div>
        {confirmRemove && <div className="deck-status"><span>Remove this schedule? Its tasks stay in the project.</span>
          <button className="button small" disabled={locked} onClick={async () => {
            if (await action("remove-schedule", schedule.id)) { setConfirmRemove(false); setDraft(null); }
          }}>Confirm removal</button></div>}
        {waiting && <p className="setting-detail">This occurrence is saved. An enabled schedule resumes it when usage returns. Cancel the waiting run before editing.</p>}
        <h3>Run history</h3>
        {!schedule.runs.length && <p className="setting-detail">No runs yet.</p>}
        {schedule.runs.map((run) => <div className="deck-run-row" key={run.id}>
          <div><strong>{run.status}</strong><span>{formatDate(run.startedAt)}</span>
            <p>{Object.entries(run.agents ?? {}).map(([agent, status]) => `${agentNames[agent]} · ${status}`).join("  /  ")}</p>
            {run.detail && <p>{run.detail}</p>}</div>
          {run.status === "waiting for usage" && <button className="button small" disabled={locked} onClick={() => action("cancel-waiting-schedule", schedule.id)}>Cancel waiting run</button>}
          {run.taskId && <button className="button small" disabled={locked} onClick={() => openTask(run.repo, run.taskId)}>Open task</button>}
        </div>)}
      </article>}
    </div>}
    {!schedules.length && editor}
    <footer className="deck-page-links">
      <button className="thread-text-button" onClick={() => openProvider("codex-scheduled")}><IconExternalLink size={14} />Codex scheduled tasks</button>
      <button className="thread-text-button" onClick={() => openProvider("claude-cloud")}><IconExternalLink size={14} />Claude cloud tasks</button>
    </footer>
  </WorkbenchPage>;
}

const features = {
  team: [
    ["Timeline, Split, queue and run history", "In AI Deck", "Projects and per-task worktrees"],
    ["Low RAM", "In AI Deck", "Run the agent CLIs one at a time and check available system memory"],
    ["Build → Review in either direction", "In AI Deck", "The second agent reviews the captured diff"],
    ["Questions and usage handoff", "In AI Deck", "Answer either agent in chat and choose to continue an interrupted build with the other agent"],
    ["Parallel edits", "In AI Deck", "One worktree per writer · compare patches in Changes"],
    ["Scheduled", "In AI Deck", "Local cadence, agent roles, permissions and run history"],
    ["Knowledge, SKILL.md and HTTP MCP", "In AI Deck", "Project scope and explicit enabled sources"],
    ["Text attachments and task search", "In AI Deck", "Attach text to the draft and search local task titles"],
    ["Browser, terminal, PR and cloud workflow", "Provider apps", "Manage these workflows from the provider’s interface"],
  ],
  codex: [
    ["Resume, Steer, command and patch approvals", "In AI Deck", "Native Codex App Server"],
    ["Model, reasoning effort and speed", "In AI Deck", "Open Codex beside the message box. Account limits are in Usage."],
    ["Cloud tasks and original schedules", "Provider app", "Open Codex web or its desktop Scheduled tab", "codex-cloud"],
    ["Goal and fork", "In AI Deck", "Native goal control and conversation fork into a fresh worktree"],
    ["Browser, desktop plugins and Dot", "Provider app", "Use the corresponding feature in the original app", "codex-cloud"],
  ],
  claude: [
    ["Resume, review, plan and edit", "In AI Deck", "Apply a completed plan in the same Claude session"],
    ["Run tests with approval", "In AI Deck", "Enable Git Bash requests for Claude Edit in Team settings"],
    ["Model, effort, speed, fallback and output style", "In AI Deck", "Open Claude Code beside the message box."],
    ["Account-level usage", "Provider app", "AI Deck also shows reported usage in each run.", "claude-usage"],
    ["Hooks, subagents, checkpoint / rewind and plugin marketplace", "Provider app", "Open Claude Desktop or its Code tab", "claude-desktop"],
    ["Remote Control and cloud scheduled tasks", "Provider app", "Open Claude Code in the browser", "claude-cloud"],
    ["Claude Chat, Cowork and Artifacts", "Provider app", "Open Claude's original interface", "claude-desktop"],
  ],
};

export function FeatureMap({ go, openProvider, error }) {
  const [scope, setScope] = useState("team");
  return <WorkbenchPage title="Feature map" scope="AI Deck" description="Browse Team, Codex and Claude capabilities.">
    {error && <p className="live-error" role="alert">{error}</p>}
    <div className="thread-segments deck-scope" role="group" aria-label="Feature scope">
      {Object.entries({ team: "Team", ...agentNames }).map(([key, label]) => <button key={key} aria-pressed={scope === key}
        onClick={() => setScope(key)}>{label}</button>)}
    </div>
    <div className="deck-tool-grid deck-feature-grid">
      {features[scope].map(([title, status, description, destination]) => <article className="deck-box deck-feature" key={title}>
        <div><h3>{title}</h3><p>{description}</p></div>
        {destination ? <button className="button small" onClick={() => openProvider(destination)}><IconExternalLink size={14} />{status}</button>
          : <span className="source-pill">{status}</span>}
      </article>)}
    </div>
    <button className="button small deck-scope" onClick={() => go("settings")}>Open settings</button>
  </WorkbenchPage>;
}
