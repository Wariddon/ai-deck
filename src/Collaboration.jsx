import { useEffect, useRef, useState } from "react";
import { IconArrowsExchange, IconBolt, IconGripVertical, IconLayersLinked } from "@tabler/icons-react";
import { agentRole, discussionMode, effectiveTeamwork, separateEditsIssue, swapTeamAssignment, teamFields, teamWorkflowMode, workflowFamily } from "../desktop/collaboration.mjs";
import { routeMode } from "../desktop/usage-routing.mjs";
import { agentNames, AssignmentEvidence, modeLabel, projectName } from "./TeamThread.jsx";

const teamChoices = {
  [discussionMode]: "Discuss together · no edits",
  "auto-team": "Auto Team · agree, implement and cross-review",
  "build-review": "Implement → Review the resulting diff",
  "codex-plan-claude": "Plan → Approve → Implement",
  team: "Implement and review the starting snapshot",
  "parallel-write": "Edit in separate worktrees",
};
const soloChoices = ["codex", "codex-plan", "codex-review", "claude", "claude-plan", "claude-write"];
const roleNames = { plan: "Plan", review: "Review", write: "Implement" };
const roleExample = {
  plan: "Example: map the files and propose a test plan.",
  review: "Example: check regressions and missing tests.",
  write: "Example: implement the changes and run the tests.",
};

export function TeamPlan({ mode, lowMemory, value, once, session, sessionTitle, readOnly, projectDefault, projectMode,
  running, queued, presets, editPreset, canSave, canSaveProject, busy, apply, saveSession, resetSession, saveDefault, brand, close }) {
  const [flow, setFlow] = useState(mode);
  const [saveScope, setSaveScope] = useState(canSave && !once ? "session" : "next");
  const originalBrief = effectiveTeamwork(value, session, projectDefault) ?? {};
  const [brief, setBrief] = useState(originalBrief);
  const dirty = flow !== mode || teamFields.some((key) => (originalBrief[key] ?? "") !== (brief[key] ?? ""));
  const [dragAgent, setDragAgent] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetId, setPresetId] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const agents = routeMode(flow, {}).requested;
  const family = workflowFamily(flow);
  const automatic = family === "auto-team";
  const separateIssue = separateEditsIssue(flow, brief);
  const discussion = flow === discussionMode;
  const canSwap = agents.length === 2 && !automatic && !discussion;
  const ordered = family === "build-review" || family === "codex-plan-claude";
  const summary = ({
    "auto-team": "Codex proposes a plan and Claude checks it and assigns the work. Approve before either edits. The team reviews the diff and can request one fix round per assignment.",
    "codex-plan-claude": "Approve the read-only plan before implementation starts.",
    "build-review": "The reviewer receives the resulting diff and the builder’s handoff.",
    "parallel-write": "Give each writer its own paths. Each agent edits a separate worktree. AI Deck checks both Git diffs after the run.",
    [discussionMode]: "AI Deck sends Codex’s opening reply to Claude. Each agent replies once, without project tools.",
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
    const next = swapTeamAssignment(flow, brief);
    if (!next) return;
    const [first, second] = routeMode(next.mode, {}).requested;
    setFlow(next.mode);
    setBrief(next.teamwork);
    setDragAgent(null);
    setAnnouncement(agentNames[first] + " now owns the first card. " + agentNames[second] + " owns the second.");
  }

  function field(name, label, placeholder, rows = 2) {
    return <label className="field"><strong>{label}</strong>
      <textarea rows={rows} maxLength={1500} placeholder={placeholder} value={brief[name] ?? ""}
        onChange={(event) => setBrief({ ...brief, [name]: event.target.value })} />
    </label>;
  }

  return <form className="deck-team-form" onSubmit={(event) => {
    event.preventDefault();
    if (busy || separateIssue) return;
    if (saveScope === "project" && canSaveProject) void saveDefault(flow, brief);
    else if (saveScope === "session" && canSave) void saveSession(flow, brief);
    else apply(flow, brief);
  }}>
    <div className="deck-team-scope">
      <div><p className="deck-kicker">Shared team brief</p><strong title={sessionTitle}>{sessionTitle || "Current draft"}</strong></div>
      <span className="source-pill">{dirty ? "Unsaved changes" : once ? "Next message only" : value !== undefined || session && session.mode !== mode ? "Draft override" : session ? "Session default" : "Project brief"}</span>
    </div>
    {running && <AssignmentEvidence mode={running.mode} teamwork={running.teamwork} label="Current run roles" lowMemory={running.lowMemory} />}
    {queued > 0 && <p className="setting-detail deck-team-hint">{queued} {queued === 1 ? "message keeps its" : "messages keep their"} saved roles in the queue.</p>}
    <div className="deck-team-controls">
      <label className="field"><strong>Workflow</strong><select value={family} onChange={(event) => {
        setFlow(teamWorkflowMode(event.target.value, agents[0]));
        setAnnouncement("");
      }}>
        <optgroup label="Team">{Object.entries(teamChoices).map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}</optgroup>
        <optgroup label="One agent">{soloChoices.map((choice) => <option key={choice} value={choice}>{modeLabel(choice, lowMemory)}</option>)}</optgroup>
      </select></label>
      {canSwap && <button className="button small" type="button" onClick={swap}><IconArrowsExchange size={16} />Swap agents</button>}
    </div>
    <p className="setting-detail deck-team-hint">{summary}{lowMemory && agents.length === 2 && " · Low RAM runs one agent at a time."}</p>
    {canSwap && <p className="setting-detail deck-team-hint">Drag or use Swap agents. Responsibilities stay with the role.</p>}
    <div className={"deck-role-board" + (agents.length === 2 ? " has-two-roles" : "")} aria-label="Role board">
      {agents.map((agent, index) => {
        const role = agentRole(flow, agent);
        const step = automatic ? "Planning step " + (index + 1) : !canSwap ? "Solo" : ordered || lowMemory ? "Step " + (index + 1) : "Lane " + (index === 0 ? "A" : "B");
        const eligible = Boolean(dragAgent && dragAgent !== agent);
        return <section className={"deck-role-card" + (eligible ? " is-drop-target" : "")}
          data-slot={index + 1} data-agent={agent} aria-label={step + " " + roleNames[role]}
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
            : automatic && index ? "Codex’s proposal, the current files and the shared brief" : roleInput(role)}</p>
          {!discussion && field(agent, automatic ? "Assignment preferences" : "Responsibilities",
            automatic ? "Example: prefer test coverage and keep edits scoped." : roleExample[role])}
          {family === "parallel-write" && field(agent + "Paths", "Write paths · " + agentNames[agent],
            agent === "codex" ? "src/api/\nsrc/routes.js" : "tests/\nREADME.md")}
        </section>;
      })}
    </div>
    {family === "parallel-write" && <p className="setting-detail deck-team-hint">Use one repository-relative path per line. End folder paths with a slash.</p>}
    {separateIssue && <p className="live-error" role="status">{separateIssue}</p>}
    {readOnly && <p className="setting-detail deck-team-hint">This project is read-only.</p>}
    <div className="deck-form-grid deck-team-notes">
      {field("brief", "Shared brief", "What should both agents know?")}
      {field("outcome", "Done when / handoff", "What should they check and hand over?")}
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
      <label className="field"><strong>Apply to</strong>
        <select value={saveScope === "project" && !canSaveProject ? "session" : saveScope} disabled={busy} onChange={(event) => setSaveScope(event.target.value)}>
          <option value="next">Next message only</option>
          {canSave && <option value="session">This session</option>}
          {canSaveProject && <option value="project">Project default</option>}
        </select>
      </label>
      <div className="dialog-actions deck-team-actions">
        <button className="button small" type="button" onClick={close}>Cancel</button>
        {canSave && (value !== undefined || session || projectMode && projectMode !== flow) && <button className="button small" type="button" disabled={busy}
          onClick={resetSession}>Use project default</button>}
        <button className="button small primary" disabled={busy || Boolean(separateIssue) || (saveScope === "project" && !canSaveProject)}>Apply roles</button>
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
  { name: "inbox", label: "Open the team inbox across projects" },
  { name: "plan", label: "Select read-only planning for one agent", mode: true },
  { name: "review", label: "Select read-only review for one agent", mode: true },
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

export function TeamPlanButton({ active, once, onClick }) {
  return <button className="button small" type="button" onClick={onClick} aria-label="Team Brief">
    <IconLayersLinked size={14} />Team Brief{(active || once) && <span className="source-pill">{once ? "Once" : "Set"}</span>}
  </button>;
}
