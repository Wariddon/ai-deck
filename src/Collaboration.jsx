import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { IconArrowsExchange, IconBolt, IconGripVertical } from "@tabler/icons-react";
import { agentRole, discussionMode, effectiveTeamwork, needsAutomaticAssignments, parallelChecksMode, separateEditsIssue, swapTeamAssignment, teamFields, teamWorkflowMode, workflowFamily } from "../desktop/collaboration.mjs";
import { routeMode } from "../desktop/usage-routing.mjs";
import { agentNames, AssignmentEvidence, modeLabel, projectName } from "./TeamThread.jsx";

const teamChoices = {
  [discussionMode]: "Discuss together · no edits",
  [parallelChecksMode]: "Team · Independent checks",
  "auto-team": "Auto Team · agree, implement and cross-review",
  "build-review": "Implement → Review the resulting diff",
  "codex-plan-claude": "Plan → Approve → Implement",
  team: "Implement and review the starting snapshot",
  "parallel-write": "Both edit · Separate worktrees",
};
const soloChoices = ["codex", "codex-plan", "codex-review", "claude", "claude-plan", "claude-write"];
const roleNames = { plan: "Plan", review: "Review", write: "Implement" };
const roleExample = {
  plan: "Example: map the files and propose a test plan.",
  review: "Example: check regressions and missing tests.",
  write: "Example: implement the changes and run the tests.",
};

export function TeamPlan({ mode, lowMemory, value, once, session, sessionTitle, readOnly, projectDefault, projectMode,
  running, queued, presets, editPreset, pickFiles, canSave, canSaveProject, busy, apply, saveSession, resetSession, saveDefault, brand, close, closeRequest }) {
  const [flow, setFlow] = useState(mode);
  const [saveScope, setSaveScope] = useState(canSave && !once ? "session" : "next");
  const originalBrief = effectiveTeamwork(value, session, projectDefault) ?? {};
  const [brief, setBrief] = useState(originalBrief);
  const dirty = flow !== mode || originalBrief.planner !== brief.planner ||
    teamFields.some((key) => (originalBrief[key] ?? "") !== (brief[key] ?? ""));
  const [dragAgent, setDragAgent] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetId, setPresetId] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const closingDirty = confirmDiscard && dirty;
  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else close();
  }
  useImperativeHandle(closeRequest, () => requestClose);
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const family = workflowFamily(flow);
  const automatic = family === "auto-team";
  const agents = automatic && brief.planner === "claude" ? ["claude", "codex"] : routeMode(flow, {}).requested;
  const autoAssign = needsAutomaticAssignments(flow, brief);
  const separateIssue = autoAssign ? "" : separateEditsIssue(flow, brief);
  const saveDisabled = busy || Boolean(separateIssue) || autoAssign && (readOnly || !canSave) || saveScope === "project" && !canSaveProject;
  const discussion = flow === discussionMode;
  const canSwap = agents.length === 2 && !discussion && flow !== parallelChecksMode;
  const ordered = family === "build-review" || family === "codex-plan-claude";
  const summary = ({
    "auto-team": agentNames[agents[0]] + " finds files and proposes a plan. " + agentNames[agents[1]] + " checks the graph and assigns the work. Approve before either edits.",
    "codex-plan-claude": "Approve the read-only plan before implementation starts.",
    "build-review": "The reviewer receives the resulting diff and the builder’s handoff.",
    "parallel-write": "Leave both file lists empty for automatic assignment, or pick different files for each agent.",
    [discussionMode]: "AI Deck sends Codex’s opening reply to Claude. Each agent replies once, without project tools.",
    [parallelChecksMode]: "Both agents check the same snapshot independently with read-only access.",
    team: "The reviewer uses the worktree snapshot captured before the run.",
  })[family] ?? "Only the selected agent runs.";

  function roleInput(role) {
    if (role === "review") return family === "build-review" ? "Builder’s diff and handoff after implementation" : "Checkout snapshot from before the run";
    if (role === "plan") return "Current files and the shared brief";
    if (family === "codex-plan-claude") return "The plan after you approve it";
    if (family === "parallel-write") return "Its own isolated worktree";
    return "Current worktree and the shared brief";
  }

  function swap() {
    if (automatic) {
      setBrief({ ...brief, planner: agents[1] === "claude" ? "claude" : undefined });
      setDragAgent(null);
      setAnnouncement(agentNames[agents[1]] + " now proposes the plan. " + agentNames[agents[0]] + " checks it.");
      return;
    }
    const next = swapTeamAssignment(flow, brief);
    if (!next) return;
    const [first, second] = routeMode(next.mode, {}).requested;
    setFlow(next.mode);
    setBrief(next.teamwork);
    setDragAgent(null);
    setAnnouncement(agentNames[first] + " now owns the first card. " + agentNames[second] + " owns the second.");
  }

  function chooseWorkflow(next) {
    if (next === "auto-team" && !automatic) setBrief({ ...brief, planner: agents[0] === "claude" ? "claude" : undefined });
    setFlow(teamWorkflowMode(next, agents[0]));
    setAnnouncement("");
  }

  async function addWriteFiles(agent) {
    const result = await pickFiles(agent);
    if (!result?.paths.length) return;
    const key = agent + "Paths";
    const current = (brief[key] ?? "").split(/\r?\n/u).map((file) => file.trim()).filter(Boolean);
    const paths = [...new Set([...current, ...result.paths])];
    const text = paths.join("\n");
    if (paths.length > 24 || text.length > 1500) {
      setAnnouncement("Choose up to 24 paths within 1,500 characters for each writer.");
      return;
    }
    setBrief((previous) => ({ ...previous, [key]: text }));
    setAnnouncement("Added write paths for " + agentNames[agent] + ".");
  }

  function field(name, label, placeholder, rows = 2) {
    return <label className="field"><strong>{label}</strong>
      <textarea rows={rows} maxLength={1500} placeholder={placeholder} value={brief[name] ?? ""}
        onChange={(event) => setBrief({ ...brief, [name]: event.target.value })} />
    </label>;
  }

  return <form className="deck-team-form" onSubmit={(event) => {
    event.preventDefault();
    if (saveDisabled) return;
    if (saveScope === "project" && canSaveProject) void saveDefault(flow, brief);
    else if (saveScope === "session" && canSave) void saveSession(flow, brief);
    else apply(flow, brief);
  }}>
    <div className="deck-team-scope">
      <div><p className="deck-kicker">Shared team brief</p><strong title={sessionTitle}>{sessionTitle || "Current draft"}</strong></div>
      <span className="source-pill">{dirty ? "Unsaved changes" : once ? "Next message only" : value !== undefined || session && session.mode !== mode ? "Draft override" : session ? "Session default" : "Project brief"}</span>
    </div>
    {running && <AssignmentEvidence mode={running.mode} teamwork={running.teamwork} planner={running.autoTeam?.planner} label="Current run roles" lowMemory={running.lowMemory} />}
    {queued > 0 && <p className="setting-detail deck-team-hint">{queued} {queued === 1 ? "message keeps its" : "messages keep their"} saved roles in the queue.</p>}
    <div className="deck-team-controls">
      <label className="field"><strong>Workflow</strong><select value={family} onChange={(event) => chooseWorkflow(event.target.value)}>
        <optgroup label="Team">{Object.entries(teamChoices).map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}</optgroup>
        <optgroup label="One agent">{soloChoices.map((choice) => <option key={choice} value={choice}>{modeLabel(choice, lowMemory)}</option>)}</optgroup>
      </select></label>
      {canSave && <button className="button small" type="button" disabled={busy || readOnly}
        aria-pressed={family === "parallel-write"} onClick={() => chooseWorkflow("parallel-write")}>Both edit</button>}
      {canSwap && <button className="button small" type="button" onClick={swap}><IconArrowsExchange size={16} />Swap agents</button>}
    </div>
    <p className="setting-detail deck-team-hint">{summary}{lowMemory && agents.length === 2 && " · Low RAM runs one agent at a time."}</p>
    {canSwap && <p className="setting-detail deck-team-hint">{automatic || autoAssign
      ? "Drag or use Swap agents to change who proposes and who checks the plan."
      : "Drag or use Swap agents. Responsibilities stay with the role."}</p>}
    <div className={"deck-role-board" + (agents.length === 2 ? " has-two-roles" : "")} aria-label="Role board">
      {agents.map((agent, index) => {
        const role = agentRole(flow, agent);
        const step = automatic ? "Planning step " + (index + 1) : agents.length === 1 ? "Solo" : ordered || lowMemory ? "Step " + (index + 1) : "Lane " + (index === 0 ? "A" : "B");
        const eligible = Boolean(dragAgent && dragAgent !== agent);
        return <section className={"deck-role-card" + (eligible ? " is-drop-target" : "")}
          data-slot={index + 1} data-agent={agent} aria-label={step + " " + (automatic ? index ? "Check & assign" : "Propose" : roleNames[role])}
          key={index} onDragOver={(event) => {
            if (!eligible) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }} onDrop={(event) => {
            if (!eligible || event.dataTransfer.getData("text/plain") !== dragAgent) return;
            event.preventDefault();
            swap();
          }}>
          <header className="deck-role-heading">
            <div><p className="deck-kicker">{step}</p><h3>{automatic ? index ? "Check & assign" : "Propose" : roleNames[role]}</h3></div>
            <span className="source-pill">{role === "write" && !readOnly ? "Worktree edits" : "Read-only"}</span>
          </header>
          <div className="deck-role-agent" draggable={canSwap} data-draggable={canSwap}
            onDragStart={(event) => {
              if (!canSwap) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", agent);
              setDragAgent(agent);
            }} onDragEnd={() => setDragAgent(null)}>
            {canSwap && <IconGripVertical size={16} aria-hidden="true" />}
            {brand(agent)}<strong>{agentNames[agent]}</strong>
          </div>
          <p className="deck-role-input"><strong>Sees</strong> {discussion ? index ? "Your message and the opening reply" : "Your message"
            : automatic && index ? agentNames[agents[0]] + "’s proposal, the dependency graph and the shared brief" : roleInput(role)}</p>
          {!discussion && field(agent, automatic ? "Assignment preferences" : family === "parallel-write" ? "Responsibilities (optional)" : "Responsibilities",
            automatic ? "Example: prefer test coverage and keep edits scoped." : roleExample[role])}
          {family === "parallel-write" && <>
            {field(agent + "Paths", "Write paths · " + agentNames[agent], agent === "codex" ? "src/api/\nsrc/routes.js" : "tests/\nREADME.md")}
            <div className="thread-actions"><button className="button small" type="button" disabled={!canSave || busy || readOnly}
              aria-label={"Pick files for " + agentNames[agent]} onClick={() => void addWriteFiles(agent)}>Pick files…</button></div>
          </>}
        </section>;
      })}
    </div>
    {family === "parallel-write" && <p className="setting-detail deck-team-hint">{autoAssign
      ? agentNames[agents[0]] + " will propose the file assignments and " + agentNames[agents[1]] + " will check them before you approve edits."
      : "Use one repository-relative path per line. End folder paths with a slash. Applying roles to the draft selects Edit files."}</p>}
    {separateIssue && <p className="setting-detail deck-team-hint" role="status">{separateIssue}</p>}
    {readOnly && <p className="setting-detail deck-team-hint">This project is read-only.</p>}
    <div className="deck-form-grid deck-team-notes">
      {field("brief", "Goal and shared context", "What should both agents accomplish?")}
      {field("outcome", "Acceptance and handoff", "What evidence will show the work is complete?")}
      {field("constraints", "Constraints", "What limits or existing behavior must the team respect?")}
      {field("questions", "Open questions", "Which assumptions still need evidence or a decision?")}
    </div>
    <details className="deck-role-presets">
      <summary>Role presets</summary>
      <p className="setting-detail">Reuse a workflow and its written responsibilities across sessions.</p>
      <div className="deck-team-controls">
        <label className="field"><strong>Saved preset</strong><select value={presetId} onChange={(event) => { setPresetId(event.target.value); setConfirmRemove(false); }}>
          <option value="">Choose preset</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select></label>
        <button className="button small" type="button" disabled={!selectedPreset || busy} onClick={() => {
          setFlow(selectedPreset.mode);
          setBrief({ ...selectedPreset.teamwork });
          setDragAgent(null);
          setAnnouncement("Loaded " + selectedPreset.name + ".");
        }}>Load roles</button>
        {selectedPreset && <button className="button small" type="button" disabled={busy} onClick={async () => {
          if (!confirmRemove) { setConfirmRemove(true); return; }
          if (await editPreset({ action: "remove", id: presetId })) { setPresetId(""); setConfirmRemove(false); }
        }}>{confirmRemove ? "Confirm removal" : "Remove preset"}</button>}
      </div>
      <div className="deck-team-controls">
        <label className="field"><strong>New preset name</strong><input maxLength={70} value={presetName}
          onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} /></label>
        <button className="button small" type="button" disabled={!presetName.trim() || busy || Boolean(separateIssue)} onClick={async () => {
          const next = await editPreset({ action: "save", name: presetName, mode: flow, teamwork: brief });
          if (next) { setPresetId(next.rolePresets.at(-1).id); setPresetName(""); setConfirmRemove(false); }
        }}>Save preset</button>
      </div>
    </details>
    <p className="deck-role-announcement" role="status">{announcement}</p>
    <div className="deck-team-save">
      {closingDirty && <p className="setting-detail deck-team-unsaved" role="status">Save your changes or discard them to close Team Brief.</p>}
      <label className="field"><strong>Save to</strong>
        <select value={saveScope === "project" && !canSaveProject ? "session" : saveScope} disabled={busy} onChange={(event) => setSaveScope(event.target.value)}>
          <option value="next">Next message only</option>
          {canSave && <option value="session">This session</option>}
          {canSaveProject && <option value="project">Project default</option>}
        </select>
      </label>
      <div className="dialog-actions deck-team-actions">
        {closingDirty ? <>
          <button className="button small" type="button" disabled={busy} onClick={() => setConfirmDiscard(false)}>Keep editing</button>
          <button className="button small" type="button" disabled={busy} onClick={close}>Discard changes</button>
        </> : <button className="button small" type="button" disabled={busy} onClick={requestClose}>Cancel</button>}
        {!closingDirty && canSave && (value !== undefined || session || projectMode && projectMode !== flow) && <button className="button small" type="button" disabled={busy}
          onClick={resetSession}>Use project default</button>}
        <button className="button small primary" type="submit" disabled={saveDisabled}>
          {saveScope === "next" ? "Apply to next message" : "Save team setup"}
        </button>
      </div>
    </div>
  </form>;
}

export function SharedSkills({ skills, library, repo, busy, action, importSkill, publish, openLibrary }) {
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(true);
  function reset() { setEditing(null); setName(""); setText(""); setEnabled(true); }
  return <div className="deck-tool-grid">
    <section className="deck-box">
      <h2>Shared skills</h2>
      <p className="setting-detail">Enable a skill for both agents in this project, or choose it once with /skill in the composer.</p>
      <div className="thread-actions">
        <button className="button small" type="button" disabled={busy} onClick={importSkill}>Import SKILL.md</button>
        <button className="button small" type="button" onClick={openLibrary}>Open local library</button>
      </div>
      {!skills.length && <p className="empty">No shared skills yet.</p>}
      <div className="setting-list">
        {skills.map((skill) => {
          const published = library.find((entry) => entry.repo === repo && entry.noteId === skill.id);
          const available = library.find((entry) => entry.id === skill.libraryId);
          return <div className="live-note" key={skill.id}>
            <label className="plugin-enable"><input type="checkbox" checked={skill.enabled} disabled={busy}
              onChange={(event) => action({ action: "note-toggle", id: skill.id, enabled: event.target.checked })} />
              <strong>{skill.name}</strong><span className="source-pill">{skill.enabled ? "Project · both agents" : "Available for one turn"}</span>
            </label>
            <details><summary>Preview instructions</summary><pre className="file-preview">{skill.text}</pre></details>
            {skill.libraryId && <p className="setting-detail">Library v{skill.libraryRevision}{available?.revision > skill.libraryRevision && " · v" + available.revision + " available"}</p>}
            {published && <p className="setting-detail">Published v{published.revision}</p>}
            <div className="thread-actions">
              {!skill.libraryId && <>
                <button className="button small" type="button" disabled={busy} onClick={() => { setEditing(skill.id); setName(skill.name); setText(skill.text); }}>Edit</button>
                <button className="button small" type="button" disabled={busy} onClick={() => publish(skill.id)}>{published ? "Publish current version" : "Save to library"}</button>
              </>}
              <button className="button small" type="button" disabled={busy} onClick={async () => {
                if (await action({ action: "note-remove", id: skill.id }) && editing === skill.id) reset();
              }}>Remove</button>
            </div>
          </div>;
        })}
      </div>
    </section>
    <form className="deck-box" onSubmit={async (event) => {
      event.preventDefault();
      if (await action(editing ? { action: "skill-edit", id: editing, name, text } : { action: "note-add", source: "Skill", name, text, enabled })) reset();
    }}>
      <h2>{editing ? "Edit shared skill" : "Add shared skill"}</h2>
      <label className="field"><strong>Skill name</strong><input required maxLength={160} placeholder="review-checklist"
        disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><strong>Skill instructions</strong><textarea required rows={7} maxLength={24000}
        placeholder="Describe when to use this skill and the steps to follow." disabled={busy} value={text} onChange={(event) => setText(event.target.value)} /></label>
      {!editing && <label className="plugin-enable"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />Enable for both agents</label>}
      <p className="setting-detail">AI Deck shares the instruction text. Configure scripts, tools and dependencies separately.</p>
      <div className="thread-actions"><button className="button primary small" disabled={busy}>{editing ? "Save changes" : "Add shared skill"}</button>
        {editing && <button className="button small" type="button" disabled={busy} onClick={reset}>Cancel edit</button>}</div>
    </form>
  </div>;
}

export function LocalSkillLibrary({ library, skills, projects, workspace, busy, pickProject, choose, preview }) {
  const [query, setQuery] = useState("");
  const list = library.filter((entry) => (entry.name + " " + projectName(entry.repo)).toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <p className="setting-detail">Save a project skill here to reuse its instructions. Each project keeps its chosen version until you update it.</p>
    <div className="deck-form-grid deck-library-filters">
      <label className="field"><strong>Project for this copy</strong><select disabled={busy} value={workspace?.repo ?? ""} onChange={(event) => pickProject(event.target.value)}>
        <option value="" disabled>Choose project</option>
        {projects.map(({ repo }) => <option key={repo} value={repo}>{projectName(repo)}</option>)}
      </select></label>
      <label className="field"><strong>Search local library</strong><input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    {!workspace && <button className="button small" disabled={busy} onClick={choose}>Open repository</button>}
    {!list.length && <div className="deck-box">
      <h2>{library.length ? "No matching skills" : "Local library is empty"}</h2>
      <p className="setting-detail">{library.length ? "Try a different skill name or source project." : "Use Save to library next to a project skill to add it here."}</p>
    </div>}
    <div className="deck-tool-grid">
      {list.map((entry) => {
        const origin = workspace?.repo === entry.repo && skills.some((skill) => skill.id === entry.noteId);
        const copy = skills.find((skill) => skill.libraryId === entry.id);
        return <article className="deck-box" key={entry.id}>
          <h2>{entry.name}</h2>
          <p className="setting-detail">{projectName(entry.repo)} · Library v{entry.revision}</p>
          {origin && <p className="setting-detail">Source skill in this project</p>}
          {copy && <p className="setting-detail">This project uses v{copy.libraryRevision}{entry.revision > copy.libraryRevision && " · Update available"}</p>}
          <div className="thread-actions"><button className="button small" disabled={busy} onClick={() => preview(entry)}>Preview v{entry.revision}</button></div>
        </article>;
      })}
    </div>
  </>;
}

export function LibrarySkillPreview({ skill, copy, workspace, origin, busy, useSkill, remove, close }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return <>
    <p className="dialog-intro"><strong>{skill.name} · v{skill.revision}</strong> · Published from {projectName(skill.repo)}</p>
    <pre className="file-preview deck-continuation">{skill.text}</pre>
    {workspace && !origin && !copy && <p className="setting-detail">Added to {projectName(workspace.repo)} as on demand. Use /skill or enable it for both agents in Shared skills.</p>}
    {copy && <p className="setting-detail">{projectName(workspace.repo)} uses v{copy.libraryRevision}. Updating keeps its current enabled setting.</p>}
    {origin && <p className="setting-detail">Edit and publish the source from Shared skills in this project.</p>}
    {!workspace && <p className="setting-detail">Choose a project in the local library to use this skill.</p>}
    {confirmRemove && <p className="setting-detail">Remove this library entry? Copies already added to projects keep their saved instructions.</p>}
    <div className="dialog-actions">
      <button className="button small" onClick={close}>Close</button>
      {confirmRemove ? <button className="button small" disabled={busy} onClick={remove}>Confirm removal</button>
        : <button className="button small" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove from library</button>}
      {workspace && !origin && copy?.libraryRevision !== skill.revision && <button className="button small primary" disabled={busy || confirmRemove} onClick={useSkill}>
        {copy ? "Update to v" + skill.revision : "Add to " + projectName(workspace.repo)}
      </button>}
    </div>
  </>;
}

export function SkillPicker({ skills, selected, toggle, close, openLibrary }) {
  return <>
    <p className="dialog-intro">Add skills to this draft. Project defaults are included automatically.</p>
    {!skills.length && <p className="empty">Add or import a shared skill to get started.</p>}
    <div className="setting-list">
      {skills.map((skill) => <label className="setting-row" key={skill.id}>
        <input type="checkbox" checked={skill.enabled || selected.includes(skill.id)} disabled={skill.enabled} onChange={() => toggle(skill.id)} />
        <span><strong>{skill.name}</strong><span className="setting-detail">{skill.enabled ? "Enabled for both agents" : "Include in this draft"}</span></span>
      </label>)}
    </div>
    <div className="dialog-actions"><button className="button small" onClick={openLibrary}>Open shared skills</button>
      <button className="button primary small" onClick={close}>Done</button></div>
  </>;
}

export const slashCommands = [
  { name: "team-plan", label: "Set workflow and responsibilities" },
  { name: "auto-team", label: "Let both agents agree and review", mode: "auto-team" },
  { name: "skill", label: "Choose a shared skill for this draft", project: true },
  { name: "skills", label: "Open project skills" },
  { name: "library", label: "Open the local skill library" },
  { name: "plan", label: "Select read-only planning for one agent", mode: true },
  { name: "review", label: "Select read-only review for one agent", mode: true },
  { name: "checks", label: "Run independent read-only checks with both agents", mode: "parallel-checks" },
  { name: "team", label: "Select Team mode", mode: "team" },
  { name: "discuss", label: "Discuss a topic with Codex and Claude without opening the project", mode: discussionMode },
  { name: "build-review", label: "Codex builds, Claude reviews", mode: "build-review" },
  { name: "claude-review", label: "Claude reviews without editing", mode: "claude" },
  { name: "codex", label: "Select Codex only", mode: "codex" },
  { name: "claude", label: "Select Claude edit mode", mode: "claude-write" },
  { name: "model", label: "Open model and effort settings" },
  { name: "usage", label: "Open usage, reset times and billing" },
  { name: "status", label: "Check provider connections" },
  { name: "diff", label: "Open Git changes and review evidence" },
  { name: "scope", label: "Preview roles, skills and tool permissions", project: true },
  { name: "goal", label: "Open native Codex goal controls", project: true, codexThread: true },
  { name: "new", label: "Start a new task", project: true, idle: true },
];

export function parseSlash(text) {
  const match = /^\/([a-z-]*)(?:[ \t]+([\s\S]*))?$/iu.exec(text.trimStart());
  return match && { name: match[1].toLowerCase(), args: match[2]?.trimStart() ?? "" };
}

export function CommandMenu({ commands, selected, choose, reason }) {
  const list = useRef(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selected, commands.length]);
  return <div className="deck-command-menu">
    <div className="deck-command-title"><IconBolt size={14} /><strong>AI Deck commands</strong><span>↑ ↓ · Enter · Esc</span></div>
    <div id="deck-command-options" role="listbox" aria-label="AI Deck commands" ref={list}>
      {commands.map((command, index) => <button key={command.name} id={"deck-command-" + command.name}
        type="button" role="option" aria-selected={selected === index} aria-disabled={Boolean(reason(command))} onClick={() => choose(command)}>
        <code>/{command.name}</code><span>{reason(command) ?? command.label}</span>
      </button>)}
      {!commands.length && <p className="setting-detail">No matching command.</p>}
    </div>
  </div>;
}
