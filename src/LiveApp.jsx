import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowUp, IconArrowsMaximize, IconBrandOpenai, IconFolder, IconGitBranch, IconHistory, IconLayoutColumns,
  IconLayoutSidebar, IconLayoutSidebarRight, IconListDetails, IconPlayerStop, IconPlug, IconPlus, IconPuzzle, IconSettings, IconStack2, IconX,
  IconChevronDown, IconCpu, IconPaperclip, IconPhoto, IconTarget,
} from "@tabler/icons-react";
import claudeLogo from "simple-icons/icons/claude.svg?url";
import { activeUsageLimit, continuationFor, routeMode, singleAgentFallback } from "../desktop/usage-routing.mjs";
import { appearanceOptions, defaultAppearance } from "../desktop/appearance.mjs";
import { catalogModel, effectiveAgentSettings, efforts } from "../desktop/agent-settings.mjs";
import { agentOutput, agentRole, changeWorkflow, defaultDraftMode, effectiveTeamwork, handoffTeamwork, planPair, separateEdits, unresolvedTeamPlan, planResultCanBeConfirmed } from "../desktop/collaboration.mjs";
import { Activity, AssignmentEvidence, ImageChips, Queue, Sidebar, agentNames as names, modeLabel, modeNames, projectName } from "./TeamThread.jsx";
import { DeckNav, FeatureMap, ProjectEmpty, Scheduled, TeamInbox, WorkbenchPage } from "./DeckPages.jsx";
import { ReviewEvidence, ReviewFiles, ReviewFreshness, ReviewTarget, RunEvidence, RunScope, WorktreeComparison } from "./RunReadiness.jsx";
import { CommandMenu, LibrarySkillPreview, LocalSkillLibrary, SharedSkills, SkillPicker, TeamPlan, TeamPlanButton, parseSlash, slashCommands } from "./Collaboration.jsx";
import { TaskPanel, TaskPanelEntry } from "./TaskPanel.jsx";
import "./team-thread.css";

const connectionLabels = { ready: "Signed in", signIn: "Sign-in needed", missing: "CLI missing", wrongExecutable: "Wrong executable", unavailable: "Unavailable", upgrade: "Update CLI" };
const statusLabels = { queued: "Waiting to start", preparing: "Preparing workspace", running: "Working", completed: "Complete", failed: "Failed", interrupted: "Stopped", "awaiting-approval": "Awaiting approval", dismissed: "Dismissed", skipped: "Skipped", limited: "Usage limit reached" };
const format = new Intl.NumberFormat("en-US");
const estimateUsd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const pluginScopes = { both: "Both agents", codex: "Codex only", claude: "Claude Code only" };
const emptyPlugin = { name: "", url: "", tools: "", scope: "both", enabled: true };

function limitText(limit) {
  if (limit.kind === "credits") return "Provider reports that usage credits are required.";
  if (limit.resetAt) return "Reported reset: " + dateFormat.format(new Date(limit.resetAt));
  return "The provider did not report a reset time.";
}

function connectionLabel(connection, now) {
  return activeUsageLimit(connection?.usageLimit, now) ? "Usage limited" : connectionLabels[connection?.status] ?? "Checking";
}

function restoredActivity(workspace) {
  const rows = [];
  let statuses = {};
  let answer = "";
  for (const run of workspace?.runHistory ?? []) {
    rows.push({ id: run.id + ":prompt", kind: "prompt", text: run.prompt, images: run.images, agents: Object.keys(run.agents) });
    statuses = {};
    for (const [agent, record] of Object.entries(run.agents)) {
      statuses[agent] = record.status;
      if (agent === "claude" && record.answer) answer = record.answer;
    }
    const timeline = run.timeline ?? Object.entries(run.agents).flatMap(([agent, record]) => [
      ...record.messages.map(({ key }) => ({ agent, kind: "message", key })),
      ...(record.usageLimit ? [{ agent, kind: "limit", key: "legacy-limit" }] : []),
    ]);
    for (const item of timeline) {
      const { agent, kind, key } = item;
      const id = run.id + ":" + agent + ":" + key;
      const record = run.agents[agent];
      if (kind === "steer") rows.push({ id, agent, kind: "steered", text: item.text, images: item.images });
      else if (kind === "handoff") rows.push({ id, agent, kind: "activity", text: item.text });
      else if (kind === "limit" && record?.usageLimit) rows.push(limitRow(id, agent, record.usageLimit));
      else if (kind === "message") {
        const message = record?.messages.find((entry) => entry.key === key);
        if (message) rows.push({ id, agent, kind, text: message.text });
      }
    }
  }
  return { rows, statuses, answer };
}

function limitRow(id, agent, limit) {
  return { id, agent, kind: "system", limit: true, text: "Usage limit reached. " + limitText(limit) };
}

function Brand({ agent, size = 32 }) {
  return agent === "codex"
    ? <IconBrandOpenai size={size} stroke={1.6} aria-hidden="true" />
    : <span className="provider-icon" style={{ width: size, height: size, maskImage: `url("${claudeLogo}")` }} aria-hidden="true" />;
}

function Modal({ title, children, close, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog className={wide ? "dialog dialog-wide" : "dialog"} ref={dialog} aria-labelledby="live-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="dialog-heading">
        <div><p className="eyebrow">AI Deck</p><h2 id="live-dialog-title">{title}</h2></div>
        <button className="icon-button" aria-label="Close dialog" onClick={close}><IconX size={21} /></button>
      </header>
      <div className="deck-dialog-body">{children}</div>
    </dialog>
  );
}

function Connections({ state, now, busy, refresh, choose, docs, copy, retry, test }) {
  return (
    <>
      <p className="dialog-intro">AI Deck starts the official local CLI for each provider and uses its own sign-in. When prompted, sign in from PowerShell and refresh here.</p>
      <div className="deck-tool-grid">
        {Object.entries(names).map(([agent, name]) => {
          const connection = state[agent];
          const limit = activeUsageLimit(connection?.usageLimit, now) ? connection.usageLimit : null;
          return (
            <section className="deck-box live-connection" key={agent}>
              <div className="live-connection-title"><Brand agent={agent} size={22} /><strong>{name}</strong><span className="source-pill">{connectionLabel(connection, now)}</span></div>
              {connection?.version && <p className="setting-detail">{connection.version}{connection.authMethod ? " · " + connection.authMethod : ""}</p>}
              {connection?.status === "upgrade" && <p className="setting-detail">Use Claude Code 2.1.259 or later for interactive controls.</p>}
              {connection?.status === "signIn" && <pre className="file-preview">{connection.command}</pre>}
              {limit && <p className="setting-detail">{limitText(limit)}</p>}
              {connection?.test && <p className="setting-detail" role="status">{connection.test.ok ? "Model check passed" : "Model check failed"} · {dateFormat.format(connection.test.at)} · {connection.test.detail}</p>}
              <div className="live-buttons">
                <button className="button small" disabled={busy} onClick={() => choose(agent)}>Choose CLI .exe</button>
                <button className="button small" onClick={() => docs(agent)}>Official setup</button>
                {connection?.status === "signIn" && <button className="button small" onClick={() => copy(agent)}>Copy sign-in command</button>}
                {limit && <button className="button small" disabled={busy} onClick={() => retry(agent)}>Clear AI Deck hold</button>}
                {connection?.status === "ready" && <button className="button small" disabled={busy || Boolean(limit)}
                  onClick={() => test(agent)}>Test model (uses quota)</button>}
              </div>
            </section>
          );
        })}
      </div>
      <div className="dialog-actions"><button className="button primary" disabled={busy} onClick={refresh}>{busy ? "Checking…" : "Refresh connections"}</button></div>
    </>
  );
}

function Context({ workspace, busy, action, importNote, importProject, openPlugins, full = false }) {
  const [draft, setDraft] = useState({ source: "Project", name: "", text: "" });
  const canEdit = workspace && !busy;
  function setField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="deck-tool-grid deck-context-grid">
      <section className="deck-box">
        <h2>Shared library</h2>
        <p className="setting-detail">Enabled notes and skill instructions go to both agents on the next turn.</p>
        {!workspace?.notes.length && <p className="empty">{workspace ? "No shared notes or skills yet." : "Open a repository to manage its shared context."}</p>}
        <div className="setting-list live-context-list">
          {workspace?.notes.map((note) => (
            <div key={note.id} className="live-note">
              <label className="plugin-enable"><input type="checkbox" disabled={busy} checked={note.enabled} onChange={(event) => action({ action: "note-toggle", id: note.id, enabled: event.target.checked })} /><strong>{note.name}</strong><span className="source-pill">{note.source}</span></label>
              <details><summary>Preview text</summary><pre className="file-preview">{note.text}</pre></details>
              <button className="button small" disabled={busy} onClick={() => action({ action: "note-remove", id: note.id })}>Remove</button>
            </div>
          ))}
        </div>
        <h3>Enabled MCP servers</h3>
        {workspace?.plugins.filter((plugin) => plugin.enabled).map((plugin) => <p className="thread-plugin" key={plugin.name}>
          <IconPuzzle size={15} /><strong>{plugin.name}</strong><small>{pluginScopes[plugin.scope]}</small>
        </p>)}
        {!workspace?.plugins.some((plugin) => plugin.enabled) && <p className="setting-detail">No servers enabled.</p>}
        <div><button className="button small" onClick={openPlugins}>Manage plugins</button></div>
      </section>
      <section className="deck-box">
        <h2>Add context</h2>
      <div className="live-buttons">
        {["Codex", "Claude", "Skill", "Project"].map((source) => <button className="button small" key={source} disabled={!workspace || busy} onClick={() => importNote(source)}>Import {source === "Skill" ? "SKILL.md" : source + " notes"}</button>)}
        <button className="button small" disabled={!canEdit} onClick={importProject}>Import repo instructions</button>
      </div>
      <details className="live-context-add" open={full || undefined}>
        <summary>Write a shared note</summary>
        <form className="live-plugin-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await action({ action: "note-add", ...draft })) setDraft({ source: "Project", name: "", text: "" });
        }}>
          <div className="live-fields">
            <label className="field"><strong>Source</strong><select value={draft.source} onChange={(event) => setField("source", event.target.value)} disabled={!canEdit}>
              <option>Project</option><option>Codex</option><option>Claude</option>
            </select></label>
            <label className="field"><strong>Note name</strong><input value={draft.name} maxLength={160} onChange={(event) => setField("name", event.target.value)} disabled={!canEdit} required /></label>
          </div>
          <label className="field"><strong>Note text</strong><textarea rows={3} value={draft.text} maxLength={24000} onChange={(event) => setField("text", event.target.value)} disabled={!canEdit} required /></label>
          <button className="button small primary" disabled={!canEdit}>Add note</button>
        </form>
      </details>
        <p className="setting-detail">A SKILL.md import shares its written instructions. Configure tools and dependencies in Plugins.</p>
      </section>
    </div>
  );
}

function Appearance({ value, change, busy }) {
  const atDefault = value.uiScale === defaultAppearance.uiScale && value.textScale === defaultAppearance.textScale;
  return <section className="thread-appearance" aria-labelledby="appearance-heading">
    <h3 id="appearance-heading">Appearance</h3>
    <p className="dialog-intro">UI scale resizes the whole app. Text size adjusts the type relative to that scale. Both settings are saved on this PC.</p>
    <div className="deck-form-grid">
      {[["uiScale", "UI scale"], ["textScale", "Text size"]].map(([field, label]) => <label className="field" key={field}>
        <strong>{label}</strong>
        <select value={value[field]} disabled={busy} onChange={(event) => change({ ...value, [field]: Number(event.target.value) })}>
          {appearanceOptions[field].map((percent) => <option key={percent} value={percent}>{percent}%</option>)}
        </select>
      </label>)}
    </div>
    <button className="button small" type="button" disabled={busy || atDefault} onClick={() => change(defaultAppearance)}>Reset appearance</button>
  </section>;
}

function PerformanceSettings({ enabled, closeToTray, locked, change, changeTray, quit, readMemory }) {
  const [memory, setMemory] = useState(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readMemory().then((stats) => { if (!cancelled) setMemory(stats); }, () => {});
    return () => { cancelled = true; };
  }, [readMemory]);

  async function refresh() {
    setChecking(true);
    try { setMemory(await readMemory()); }
    catch { setMemory(null); }
    finally { setChecking(false); }
  }

  return <div className="deck-tool-grid">
    <section className="deck-box">
      <h2>Device performance</h2>
      <label className="setting-row setting-list">
      <input type="checkbox" checked={enabled} disabled={locked} onChange={(event) => change(event.target.checked)} />
      <span><strong>Low RAM</strong><span className="setting-detail">Run one agent at a time, including scheduled tasks. Turn it off to let Team run in parallel.</span></span>
    </label>
    <div className="thread-actions">
      <p className="setting-detail" role="status">{memory
        ? `${(memory.available / 1024 ** 3).toFixed(1)} GB available of ${(memory.total / 1024 ** 3).toFixed(1)} GB at last check`
        : "System memory reading unavailable."}</p>
      <button className="button small" type="button" onClick={refresh} disabled={checking}>Refresh RAM</button>
      </div>
    </section>
    <section className="deck-box">
      <h2>Window & tray</h2>
      <label className="setting-row setting-list">
      <input type="checkbox" checked={closeToTray} disabled={locked} onChange={(event) => changeTray(event.target.checked)} />
      <span><strong>Close to system tray</strong><span className="setting-detail">The X hides the window beside the clock. With Low RAM on, the idle window releases memory after about 15 seconds. Enabled schedules still run.</span></span>
      </label>
      <div><button className="button small" type="button" onClick={quit} disabled={locked}>Quit AI Deck</button></div>
    </section>
  </div>;
}

function ProjectSettings({ workspace, busy, action }) {
  const [instructions, setInstructions] = useState(workspace?.instructions ?? "");
  const [readOnly, setReadOnly] = useState(workspace?.readOnly ?? false);
  const [shareNewFiles, setShareNewFiles] = useState(workspace?.shareNewFiles ?? false);
  const [claudeCommands, setClaudeCommands] = useState(workspace?.claudeCommands === true);
  return (
    <form onSubmit={(event) => { event.preventDefault(); void action({ action: "preferences", instructions, readOnly, shareNewFiles, claudeCommands }); }}>
      <div className="deck-tool-grid">
        <section className="deck-box">
          <h2>Shared instructions</h2>
          <p className="setting-detail">Both agents use these instructions for this repository.</p>
          <label className="field"><strong>Project instructions</strong><textarea rows={6} maxLength={6000} value={instructions}
            onChange={(event) => setInstructions(event.target.value)} disabled={busy} /></label>
        </section>
        <section className="deck-box">
          <h2>Access & review</h2>
          <label className="setting-row setting-list"><input type="checkbox" checked={readOnly} disabled={busy} onChange={(event) => setReadOnly(event.target.checked)} /><span><strong>Keep the project read-only</strong><span className="setting-detail">Applies to both agents and all schedules for this project.</span></span></label>
          <label className="setting-row setting-list"><input type="checkbox" checked={shareNewFiles} disabled={busy} onChange={(event) => setShareNewFiles(event.target.checked)} /><span><strong>Include new source files in Claude reviews</strong><span className="setting-detail">Share up to six eligible untracked source files from this worktree.</span></span></label>
          <label className="setting-row setting-list"><input type="checkbox" checked={claudeCommands} disabled={busy} onChange={(event) => setClaudeCommands(event.target.checked)} />
        <span><strong>Let Claude request shell commands in Edit mode</strong><span className="setting-detail">Approve each Git Bash command in chat. It runs with your Windows account access.</span></span></label>
        </section>
      </div>
      <div className="dialog-actions deck-settings-save"><button className="button primary" disabled={busy}>Save project settings</button></div>
    </form>
  );
}

const effortLabels = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" };

function agentModelLabel(settings, catalog) {
  const { model = "", effort } = settings;
  const selected = catalogModel(catalog, model);
  const label = model ? selected?.label ?? model : selected?.resolvedModel
    ? catalog?.models.find((item) => item.value && item.resolvedModel === selected.resolvedModel)?.label ?? "CLI default"
    : selected?.label ?? "CLI default";
  return [label, effortLabels[effort], settings.speed === "fast" && "Fast"].filter(Boolean).join(" · ");
}

function AgentModelSettings({ agent, workspace, defaults, catalog, load, save, busy, canLoad }) {
  const taskSettings = workspace?.agentModels?.[agent];
  const projectSettings = workspace?.models?.[agent];
  const appDefaults = defaults?.[agent] ?? {};
  const [scope, setScope] = useState(taskSettings ? "task" : projectSettings ? "project" : "default");
  const [options, setOptions] = useState(() => ({ model: "", effort: "", speed: "", ...(taskSettings ?? projectSettings ?? appDefaults) }));
  const [custom, setCustom] = useState(false);
  const baseModels = agent === "claude" ? ["sonnet", "opus", "haiku"].map((value) => ({ value, label: value })) : [];
  const models = catalog?.models ?? baseModels;
  const capabilities = catalogModel(catalog, options.model);
  const levels = capabilities?.efforts ?? efforts[agent];
  const cliDefault = models.find((item) => !item.value);
  const unsupportedEffort = options.effort && !levels.includes(options.effort);
  const update = (field, value) => setOptions((current) => ({ ...current, [field]: value }));
  const changeModel = (model) => {
    const selected = catalogModel(catalog, model);
    setOptions((current) => ({ ...current, model,
      effort: (selected?.efforts ?? efforts[agent]).includes(current.effort) ? current.effort : "",
      speed: current.speed === "fast" && !selected?.fast ? "" : current.speed,
      fallbackModel: current.fallbackModel && (selected?.resolvedModel || model || "default") ===
        (catalogModel(catalog, current.fallbackModel)?.resolvedModel || current.fallbackModel) ? "" : current.fallbackModel,
    }));
  };
  const changeScope = (value) => {
    setScope(value);
    const inherited = value === "default" ? appDefaults : projectSettings ?? appDefaults;
    setOptions({ model: "", effort: "", speed: "", ...(value === "task" ? taskSettings ?? inherited : inherited) });
    setCustom(false);
  };
  const submit = async (value) => {
    if (await save({ agent, scope, repo: workspace?.repo, taskId: workspace?.taskId, options: value }) && value === null) {
      const inherited = scope === "task" ? projectSettings ?? appDefaults : appDefaults;
      setOptions({ model: "", effort: "", speed: "", ...inherited });
      setCustom(false);
    }
  };
  return <form className="live-plugin-form" onSubmit={(event) => {
    event.preventDefault();
    void submit({ ...options, model: options.model.trim(), fallbackModel: options.fallbackModel?.trim() });
  }}>
    <p className="dialog-intro">Changes apply from the next run. Settings follow this order: task, project, AI Deck default.</p>
    <div className="deck-form-grid">
      <label className="field"><strong>Apply to</strong><select value={scope} disabled={busy} onChange={(event) => changeScope(event.target.value)}>
        <option value="default">AI Deck default</option>{workspace && <><option value="project">This project</option><option value="task">This task</option></>}
      </select></label>
      <label className="field"><strong>Model</strong><select value={custom ? "@custom" : options.model} disabled={busy} onChange={(event) => {
        setCustom(event.target.value === "@custom");
        if (event.target.value === "@custom") changeModel("");
        else changeModel(event.target.value);
      }}>
        <option value="">{cliDefault ? (agent === "claude" ? "CLI default · " : "") + cliDefault.label : "CLI default"}</option>
        {options.model && !models.some(({ value }) => value === options.model) && <option value={options.model}>{options.model}</option>}
        {models.filter(({ value }) => value).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        <option value="@custom">Enter model ID…</option>
      </select></label>
      {custom && <label className="field"><strong>Model ID</strong><input required maxLength={160} value={options.model} disabled={busy}
        onChange={(event) => changeModel(event.target.value)} /></label>}
      <label className="field"><strong>{agent === "codex" ? "Reasoning effort" : "Effort"}</strong>
        <select value={options.effort} disabled={busy || !levels.length && !unsupportedEffort} onChange={(event) => update("effort", event.target.value)}>
          <option value="">{!levels.length ? "Managed by model" : "Automatic"}</option>
          {levels.map((level) => <option key={level} value={level}>{effortLabels[level] ?? level}</option>)}
          {unsupportedEffort && <option value={options.effort} disabled>{effortLabels[options.effort] ?? options.effort} (unavailable)</option>}
        </select>
      </label>
      <label className="field"><strong>Speed</strong><select value={options.speed} disabled={busy} onChange={(event) => update("speed", event.target.value)}>
        <option value="">CLI default</option><option value="standard">Standard</option>
        <option value="fast" disabled={!capabilities?.fast}>Fast{!capabilities?.fast ? " (unavailable)" : ""}</option>
      </select></label>
      {agent === "claude" && <>
        <label className="field"><strong>Fallback model</strong><input list="claude-fallback-models" placeholder="Off" maxLength={160}
          value={options.fallbackModel ?? ""} disabled={busy} onChange={(event) => update("fallbackModel", event.target.value)} />
          <datalist id="claude-fallback-models">{models.filter(({ value, resolvedModel }) => value && value !== options.model &&
            (!capabilities?.resolvedModel || capabilities.resolvedModel !== resolvedModel)).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</datalist>
        </label>
        <label className="field"><strong>Output style</strong><select value={options.outputStyle ?? ""} disabled={busy || !catalog?.outputStyles?.length}
          onChange={(event) => update("outputStyle", event.target.value)}>
          <option value="">CLI default</option>{[...new Set([...(catalog?.outputStyles ?? []), options.outputStyle].filter(Boolean))].map((style) =>
            <option key={style} value={style}>{style === "default" ? "Standard style" : style}</option>)}
        </select></label>
      </>}
    </div>
    {capabilities?.description && <p className="setting-detail">{capabilities.description}</p>}
    {options.speed === "fast" && <p className="setting-detail">{agent === "claude" ? "Fast can use paid usage credits." : "Fast can consume more usage."}</p>}
    {scope === "default" && (taskSettings || projectSettings) && <p className="setting-detail">This chat uses {taskSettings ? "a task" : "a project"} override.</p>}
    {scope === "project" && taskSettings && <p className="setting-detail">This chat uses a task override.</p>}
    {scope === "project" && !projectSettings && <p className="setting-detail">This project currently inherits the AI Deck default.</p>}
    {scope === "task" && !taskSettings && <p className="setting-detail">This task currently inherits {projectSettings ? "project settings" : "the AI Deck default"}.</p>}
    <div className="live-buttons">
      <button className="button primary small" disabled={busy || Boolean(unsupportedEffort) || options.speed === "fast" && !capabilities?.fast}>Save {scope === "default" ? "default" : "for " + scope}</button>
      {scope === "project" && projectSettings && <button className="button small" type="button" disabled={busy} onClick={() => void submit(null)}>Use AI Deck default</button>}
      {scope === "task" && taskSettings && <button className="button small" type="button" disabled={busy} onClick={() => void submit(null)}>Use {projectSettings ? "project settings" : "AI Deck default"}</button>}
      <button className="button small" type="button" disabled={!canLoad} onClick={load}>Refresh model list</button>
    </div>
  </form>;
}

function Plugins({ workspace, busy, action }) {
  const [draft, setDraft] = useState(emptyPlugin);
  const [editing, setEditing] = useState(false);
  function edit(plugin) {
    setDraft({ ...plugin, tools: plugin.tools.join(", ") });
    setEditing(true);
  }
  function field(key) {
    return { value: draft[key], onChange: (event) => setDraft({ ...draft, [key]: event.target.value }), disabled: !workspace || busy, required: true };
  }
  return (
    <div className="deck-tool-grid">
      <section className="deck-box">
        <h2>Project MCP servers</h2>
        <p className="setting-detail">Agent scope assigns the server. Run scope shows whether it can be used in the selected mode.</p>
      {workspace && <label className="setting-row setting-list">
        <input type="checkbox" disabled={busy} checked={workspace.inheritCodexMcp === true}
          onChange={(event) => action({ action: "codex-native-tools", enabled: event.target.checked })} />
        <span><strong>Include Codex native plugins and MCP</strong><span className="setting-detail">Applies to interactive Codex runs with write access.</span></span>
      </label>}
      {!workspace.plugins.length && <p className="empty">No MCP servers added to this project.</p>}
      <div className="setting-list">
        {workspace?.plugins.map((plugin) => (
          <div className="catalog-row" key={plugin.name}>
            <span><strong>{plugin.name}</strong><span className="setting-detail">{plugin.url}</span><span className="setting-detail">{pluginScopes[plugin.scope]} · {plugin.tools.join(", ")}</span></span>
            <div className="live-buttons">
              <label className="plugin-enable"><input type="checkbox" aria-label={`Enable ${plugin.name}`} disabled={busy} checked={plugin.enabled} onChange={async (event) => {
                const enabled = event.target.checked;
                if (await action({ action: "plugin-toggle", name: plugin.name, enabled })) {
                  setDraft((current) => current.name === plugin.name ? { ...current, enabled } : current);
                }
              }} />Enabled</label>
              <button className="button small" disabled={busy} onClick={() => edit(plugin)}>Edit</button>
              <button className="button small" disabled={busy} onClick={async () => {
                if (await action({ action: "plugin-remove", name: plugin.name }) && draft.name === plugin.name) {
                  setDraft(emptyPlugin);
                  setEditing(false);
                }
              }}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      </section>
      <form className="deck-box deck-plugin-editor" onSubmit={async (event) => {
        event.preventDefault();
        if (await action({ action: "plugin-save", ...draft })) { setDraft(emptyPlugin); setEditing(false); }
      }}>
        <h2>{editing ? "Edit MCP server" : "Add an MCP server"}</h2>
        <p className="setting-detail">Use a Streamable HTTP endpoint and choose its exact tool allowlist.</p>
        <div className="deck-form-grid">
        <label className="field"><strong>Server name</strong><input placeholder="project-tools" maxLength={37} {...field("name")} readOnly={editing} /></label>
        <label className="field"><strong>Endpoint</strong><input type="url" placeholder="https://example.com/mcp" maxLength={500} {...field("url")} /></label>
        <label className="field"><strong>Allowed tool names</strong><input placeholder="search_docs, get_issue" maxLength={1300} {...field("tools")} /></label>
        <label className="field"><strong>Available to</strong><select {...field("scope")}>
          {Object.entries(pluginScopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        </div>
        <div className="live-buttons">
          <button className="button primary" disabled={!workspace || busy}>{editing ? "Save MCP server" : "Add MCP server"}</button>
          {editing && <button type="button" className="button" onClick={() => { setDraft(emptyPlugin); setEditing(false); }}>Cancel edit</button>}
        </div>
      </form>
    </div>
  );
}

function RunPicker({ runs, value, choose, latest = false }) {
  return <label className="field"><strong>Run</strong><select value={value} onChange={(event) => choose(event.target.value)}>
    {latest && <option value="">Latest reports</option>}
    {runs.slice().reverse().map((run) => <option key={run.id} value={run.id}>{dateFormat.format(new Date(run.startedAt))} · {run.prompt.slice(0, 70)}</option>)}
  </select></label>;
}

function remainingTime(resetAt, now) {
  const minutes = Math.ceil((resetAt - now) / 60_000);
  if (minutes <= 0) return "Refresh for the current window";
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return [days && days + "d", hours % 24 && hours % 24 + "h", minutes % 60 && minutes % 60 + "m"].filter(Boolean).join(" ") + " left";
}

function QuotaWindows({ windows, empty, now }) {
  if (!windows?.length) return <p>{empty}</p>;
  return windows.map((window) => <div className="deck-usage-window" key={window.id}>
    <p>{window.name}{window.windowDurationMins ? " · " + (window.windowDurationMins % 60 === 0
      ? window.windowDurationMins / 60 + "h" : window.windowDurationMins + "m") : ""}
      {Number.isFinite(window.usedPercent) ? " · " + format.format(window.usedPercent) + "% used" : ""}
      {window.status ? " · " + window.status.replaceAll("_", " ") : ""}</p>
    {Number.isFinite(window.usedPercent) && <progress aria-label={window.name + " usage"} max={100} value={window.usedPercent} />}
    {window.resetAt && <p className="setting-detail">Reset {dateFormat.format(window.resetAt)} · {remainingTime(window.resetAt, now)}</p>}
    {!window.resetAt && window.observedAt && <p className="setting-detail">Reported {dateFormat.format(window.observedAt)}</p>}
  </div>);
}

function creditAmount(minor, currency) {
  if (!Number.isFinite(minor)) return "Unavailable";
  if (!/^[a-z]{3}$/iu.test(currency ?? "")) return format.format(minor) + " minor units";
  const currencyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency });
  return currencyFormat.format(minor / 10 ** currencyFormat.resolvedOptions().maximumFractionDigits);
}

function AccountUsage({ agent, detail, connection, load, openProvider, reset, now, busy, resetNotice }) {
  const codex = agent === "codex";
  const auth = connection?.authMethod;
  const api = codex ? auth === "api-key" : ["apiKey", "console", "api-key"].includes(auth);
  const page = api ? codex ? "openai-api" : "claude-api" : agent;
  const credits = detail?.credits;
  const windows = detail?.windows ?? (codex ? null : connection?.quota);
  const lastReport = detail?.fetchedAt ?? windows?.reduce((latest, row) => Math.max(latest, row.observedAt ?? 0), 0);
  const empty = api ? "Open the API usage dashboard for billing and account usage." : detail
    ? "The provider returned no quota windows." : "Refresh to read the current account limits.";
  return <section className="deck-status deck-quota deck-account-usage">
    <div className="live-connection-title"><Brand agent={agent} size={18} /><strong>{names[agent]} account</strong>
      {(detail?.plan || connection?.plan) && <span className="source-pill">{detail?.plan ?? connection.plan}</span>}
    </div>
    <div className="live-buttons">
      <button className="button small" disabled={busy || api || connection?.status !== "ready"} onClick={() => load(agent)}>Refresh {codex ? "Codex" : "Claude"}</button>
      <button className="button small" onClick={() => openProvider(page + "-usage")}>{api ? "API usage" : "Account usage"} ↗</button>
      <button className="button small" onClick={() => openProvider(page + "-billing")}>{api ? "API billing" : "Billing & invoices"} ↗</button>
    </div>
    <QuotaWindows windows={windows} empty={empty} now={now} />
    {credits && (codex ? <p><strong>Usage credits</strong> · {credits.unlimited ? "Unlimited" : credits.balance ??
      (credits.hasCredits ? "Available · balance unreported" : "No credits reported")}</p>
      : <div className="deck-usage-window">
        <p><strong>Usage credits</strong> · {credits.enabled ? "Enabled" : "Disabled"}</p>
        {Number.isFinite(credits.usedMinor) && <p>Reported spend · {creditAmount(credits.usedMinor, credits.currency)}</p>}
        {Number.isFinite(credits.capMinor) && <p>Monthly cap · {creditAmount(credits.capMinor, credits.currency)}</p>}
      </div>)}
    {codex && detail?.resets && <p><strong>Earned resets</strong> · {format.format(detail.resets.count)} available
      {detail.resets.expiresAt ? " · next expires " + dateFormat.format(detail.resets.expiresAt) : ""}</p>}
    {codex && detail?.resetToken && <button className="button small" disabled={busy}
      onClick={() => reset(detail.resetToken)}>{detail.resetPending ? "Check previous reset" : "Use Codex reset credit"}</button>}
    {codex && resetNotice && <p role="status">{resetNotice}</p>}
    {!codex && !api && <p className="setting-detail">If your account offers a free reset, use it in <button className="thread-text-button"
      onClick={() => openProvider("claude-usage")}>Claude Usage ↗</button>.</p>}
    {lastReport > 0 && <p className="setting-detail">Reported {dateFormat.format(lastReport)}</p>}
  </section>;
}

function Usage({ reported, runs, connections, now, busy, retry, details, load, openProvider, reset, resetNotice, usageError }) {
  const [selectedRun, setSelectedRun] = useState("");
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const run = runs.find((entry) => entry.id === selectedRun);
  return (
    <>
      {usageError && <p className="live-error" role="alert">{usageError}</p>}
      <div className="deck-tool-grid deck-account-grid">
        {Object.keys(names).map((agent) => <AccountUsage key={agent} agent={agent} detail={details[agent]} connection={connections[agent]}
          load={load} openProvider={openProvider} reset={reset} now={Math.max(clock, now)} busy={busy} resetNotice={resetNotice} />)}
      </div>
      <h3>Task usage</h3>
      <p className="dialog-intro">Provider token reports saved by AI Deck. Input includes cached input.</p>
      {runs.length > 0 && <RunPicker runs={runs} value={selectedRun} choose={setSelectedRun} latest />}
      <div className="usage-grid">
        {Object.entries(names).map(([agent, name]) => {
          const usage = run ? run.agents[agent]?.usage : reported[agent];
          const currentLimit = connections[agent]?.usageLimit;
          const limit = run ? run.agents[agent]?.usageLimit : activeUsageLimit(currentLimit, now) ? currentLimit : null;
          return (
            <section className={`usage-card ${agent}`} key={agent}>
              <h3><Brand agent={agent} size={21} />{name}</h3>
              {limit && <div className="usage-hold">
                <strong>Usage limit reached</strong>
                <p>{limitText(limit)}</p>
                {!run && <><button className="button small" disabled={busy} onClick={() => retry(agent)}>Clear AI Deck hold</button>
                  <p>This only lets the next send retry with the provider.</p></>}
              </div>}
              <p className="setting-detail">{usage?.scope ?? (run ? "No usage reported for this run" : "Waiting for reported usage")}</p>
              {usage?.lastRequest && <p className="setting-detail">Latest model request · {format.format(usage.lastRequest.total)} tokens</p>}
              {Number.isFinite(usage?.sessionEstimateUsd) && <p className="setting-detail">Claude session estimate · {estimateUsd.format(usage.sessionEstimateUsd)}
                <br />Includes earlier turns. For charges, open billing.</p>}
              {usage && <dl>
                <div><dt>Input</dt><dd>{format.format(usage.input)}</dd></div>
                <div><dt>Cached input</dt><dd>{format.format(usage.cached)}</dd></div>
                {Number.isFinite(usage.cacheWrite) && <div><dt>Cache write</dt><dd>{format.format(usage.cacheWrite)}</dd></div>}
                <div><dt>Output</dt><dd>{format.format(usage.output)}</dd></div>
                {Number.isFinite(usage.reasoning) && <div><dt>Reasoning</dt><dd>{format.format(usage.reasoning)}</dd></div>}
                <div className="usage-total"><dt>Total tokens</dt><dd>{format.format(usage.total)}</dd></div>
              </dl>}
            </section>
          );
        })}
      </div>
    </>
  );
}

const planStatus = { ready: "Ready for approval", "needs-input": "Needs your input", blocked: "Blocked", unclassified: "Needs a new plan" };

const implementationLabels = {
  "changes-ready": "Changes ready for review",
  "no-changes": "Writer finished · no Git changes detected",
  unverified: "Writer finished · Git result could not be verified",
};
const planDecisions = { dismiss: "Dismiss plan", complete: "Mark implemented", reopen: "Reopen plan" };

function SetupChanges({ changes }) {
  if (!changes.length) return null;
  return <ul className="setting-list">{changes.map((change, index) => <li className="live-note" key={index}>
    {typeof change === "string" ? change : <><strong>{names[change.agent]} settings changed</strong>
      <p className="setting-detail">Previous · {agentModelLabel(change.before)}</p>
      <p className="setting-detail">Current · {agentModelLabel(change.after)}</p></>}
  </li>)}</ul>;
}

function History({ runs, initialRun, busy, usePrompt, draftHandoff, reviewPlan, clarifyPlan, decidePlan, planContinuation }) {
  const [selectedRun, setSelectedRun] = useState(initialRun || runs.at(-1)?.id || "");
  const [decision, setDecision] = useState(null);
  const run = runs.find((entry) => entry.id === selectedRun) ?? runs.at(-1);
  if (!run) return <p className="empty">Your completed or interrupted runs will appear here after you send a task.</p>;
  const continuation = planContinuation(run.id);
  const canDismiss = run.finishedAt && unresolvedTeamPlan(run) && run.teamPlan.applyStatus !== "running";
  return (
    <>
      <p className="dialog-intro">AI Deck keeps the most recent 24 runs and any plans still awaiting a decision on this PC.</p>
      <RunPicker runs={runs} value={run.id} choose={(id) => { setSelectedRun(id); setDecision(null); }} />
      <p className="turn-prompt">{run.prompt}</p>
      <AssignmentEvidence mode={run.mode} teamwork={run.teamwork} label="Roles used in this run" lowMemory={run.lowMemory} />
      {run.lowMemory && <p className="setting-detail">Low RAM · agents ran one at a time</p>}
      {run.reviewPending && <p className="usage-hold">{names[run.pendingReviewer ?? "claude"]} review pending due to a usage limit.</p>}
      {run.followupReview && <p className="setting-detail">{names[run.pendingReviewer ?? "claude"]} review completed in a follow-up run.</p>}
      {run.reviewSkipped && <p className="setting-detail">{run.reviewSkipped}</p>}
      {run.implementationSkipped && <p className="setting-detail">{run.implementationSkipped}</p>}
      {run.skills?.length > 0 && <p className="setting-detail">Shared skills · {run.skills.map((skill) => skill.name).join(", ")}</p>}
      {run.timeline?.filter((entry) => entry.kind === "handoff").map((entry) => <p className="setting-detail" key={entry.key}>{entry.text}</p>)}
      <ReviewEvidence snapshot={run.reviewSnapshot} />
      {run.teamPlan && <section className="live-note">
        <strong>{implementationLabels[run.teamPlan.applyStatus] ?? ({ completed: run.teamPlan.decidedAt ? "Implemented" : "Completed in an earlier AI Deck release",
          dismissed: "Dismissed", running: "Implementation running", failed: "Implementation failed", interrupted: "Implementation stopped",
          limited: "Implementation paused at usage limit" })[run.teamPlan.applyStatus] ?? planStatus[run.teamPlan.state]}</strong>
        <pre className="file-preview deck-continuation">{run.teamPlan.text || "No plan text saved."}</pre>
        {decision && <p className="setting-detail">{{ dismiss: "Remove this plan from Team inbox?",
          complete: "Confirm that you reviewed the work and it satisfies the plan.",
          reopen: "Return this plan to Team inbox for another review?" }[decision]}</p>}
        <div className="thread-actions">
          {decision ? <>
            <button className="button small" disabled={busy} onClick={async () => { if (await decidePlan(run.id, decision)) setDecision(null); }}>
              {decision === "dismiss" ? "Confirm dismissal" : decision === "complete" ? "Confirm implemented" : "Confirm reopen"}
            </button>
            <button className="button small" disabled={busy} onClick={() => setDecision(null)}>Keep current status</button>
          </> : <>
            {continuation && <button className="button small" disabled={busy} onClick={() => reviewPlan(continuation)}>Review plan to apply</button>}
            {run.teamPlan.state !== "ready" && <button className="button small" disabled={busy} onClick={() => clarifyPlan(run)}>Clarify or replan</button>}
            {canDismiss && <button className="button small" disabled={busy} onClick={() => setDecision("dismiss")}>{planDecisions.dismiss}</button>}
            {planResultCanBeConfirmed(run.teamPlan.applyStatus) && <button className="button small" disabled={busy} onClick={() => setDecision("complete")}>{planDecisions.complete}</button>}
            {run.teamPlan.applyStatus === "completed" && <button className="button small" disabled={busy} onClick={() => setDecision("reopen")}>{planDecisions.reopen}</button>}
          </>}
        </div>
      </section>}
      {implementationLabels[run.implementationEvidence?.status] && <p className="setting-detail">{implementationLabels[run.implementationEvidence.status]}</p>}
      <RunEvidence evidence={run.evidence} />
      <div className="deck-tool-grid live-context-list">
        {Object.entries(run.agents).map(([agent, record]) => (
          <section key={agent} className="deck-box live-connection">
            <div className="live-connection-title"><Brand agent={agent} size={21} /><strong>{names[agent]}</strong><span className="source-pill">{statusLabels[record.status]}</span></div>
            {record.settings && <p className="setting-detail">Requested · {agentModelLabel(record.settings)}</p>}
            {record.reportedModel && <p className="setting-detail">Reported model · {record.reportedModel}</p>}
            {record.usageLimit && <p className="setting-detail">{limitText(record.usageLimit)}</p>}
            {record.messages.map((message) => <p className="live-log" key={message.key}>{message.text}</p>)}
            {!record.messages.length && <p className="setting-detail">No final response was saved.</p>}
            {agentOutput(record) && !run.teamPlan && <div><button className="button small" disabled={busy} onClick={() => draftHandoff(run, agent)}>
              Draft handoff to {names[agent === "codex" ? "claude" : "codex"]}
            </button></div>}
          </section>
        ))}
      </div>
      <div className="dialog-actions"><button className="button primary" disabled={busy} onClick={() => usePrompt(run)}>Draft this prompt</button></div>
    </>
  );
}

const emptyDraft = { prompt: "", mode: "team", reviewOf: null };
const inspectorTabs = { outputs: "Outputs", changes: "Changes", usage: "Usage", context: "Context" };
const settingsTabs = { general: "General", appearance: "Appearance", models: "Models", project: "Project", connections: "Connections" };
const modalTitles = { history: "Run history", codex: "Codex session", teamwork: "Team plan", skills: "Skills for this draft",
  scope: "Run scope", files: "Choose review files", target: "Review target", continue: "Continue in this worktree", image: "Image preview",
  queue: "Review queued setup", compare: "Compare worktrees", "panel-add": "Add task item", "panel-detail": "Task source", library: "Library skill", base: "Prepare an updated copy" };
const closedStatuses = new Set(["completed", "failed", "interrupted", "skipped", "limited", "awaiting-approval"]);
const activeStatuses = new Set(["queued", "preparing", "running"]);

function CodexSession({ action, fork, busy }) {
  const [goal, setGoal] = useState(null);
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  async function update(payload, load = false) {
    const result = await action(payload);
    if (!result) return;
    setGoal(result.goal ?? null);
    if (load) {
      setObjective(result.goal?.objective ?? "");
      setBudget(result.goal?.tokenBudget ?? "");
    }
  }
  return <>
    <p className="dialog-intro">A Codex goal applies to the current Codex session. The fork action opens a new task with the same Codex conversation and a clean worktree at the original base.</p>
    <div className="thread-actions">
      <button className="button small" disabled={busy} onClick={() => update({ action: "get-goal" }, true)}>Load current goal</button>
      <button className="button small" disabled={busy} onClick={fork}>Fork Codex chat</button>
    </div>
    {goal && <p className="deck-status" role="status">{goal.status} · {format.format(goal.tokensUsed ?? 0)} tokens
      {goal.tokenBudget ? " of " + format.format(goal.tokenBudget) : ""}</p>}
    <form className="live-plugin-form" onSubmit={(event) => {
      event.preventDefault();
      void update({ action: "set-goal", objective, budget: budget === "" ? null : Number(budget) });
    }}>
      <label className="field"><strong>Objective</strong><textarea required rows={3} maxLength={4000} value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
      <label className="field"><strong>Token budget (optional)</strong><input type="number" min={1} value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
      <div className="thread-actions">
        <button className="button primary small" disabled={busy}>Set active goal</button>
        <button className="button small" type="button" disabled={busy || !goal || goal.status === "paused"} onClick={() => update({ action: "pause-goal" })}>Pause goal</button>
        <button className="button small" type="button" disabled={busy || !goal} onClick={() => update({ action: "clear-goal" }, true)}>Clear goal</button>
      </div>
    </form>
  </>;
}

function ChangesPanel({ workspace, worktree, lane, chooseLane, snapshot, loading, error, refresh, openWorktree, draftReview, updateBase, compare, busy, lastRun, pendingReview }) {
  if (!worktree) return <p className="thread-panel-empty">The worktree will appear when you send the first task message.</p>;
  const base = snapshot?.base;
  return (
    <>
      <div className="thread-actions">
        <button className="button small" disabled={loading} onClick={refresh}>{loading ? "Reading…" : "Refresh"}</button>
        <button className="button small" onClick={openWorktree}><IconFolder size={15} />Open worktree</button>
        {workspace.claudeWorktree && <button className="button small" disabled={busy} onClick={compare}>Compare worktrees</button>}
      </div>
      {workspace.claudeWorktree && <label className="field deck-worktree-field"><strong>Worktree</strong><select value={lane} onChange={(event) => chooseLane(event.target.value)}>
        <option value="main">Main task worktree</option><option value="claude">Claude parallel worktree</option>
      </select></label>}
      <p className="thread-path" title={worktree}>{worktree}</p>
      {workspace.combinedFrom && <p className="setting-detail">Combined from {workspace.combinedFrom.title} · {workspace.combinedFrom.paths.main.length} Codex / {workspace.combinedFrom.paths.claude.length} Claude files</p>}
      {base?.commit && <section className="deck-review-freshness" aria-label="Project base">
        <p className="setting-detail">Task base · {base.from.slice(0, 8)} · Project {base.branch || "HEAD"} · {base.commit.slice(0, 8)}</p>
        {base.from !== base.commit && <>
          <p className="usage-hold">The project is now on a different commit.</p>
          <div className="thread-actions">
            <button className="button small" disabled={busy || workspace.readOnly} onClick={() => updateBase(base)}>Prepare updated copy</button>
          </div>
        </>}
        {workspace.updatedFrom && <p className="setting-detail">Source task · {workspace.updatedFrom.title} · {workspace.updatedFrom.lane === "claude" ? "Claude worktree" : "Main worktree"}</p>}
      </section>}
      {lane === "main" && <>
        {pendingReview && <p className="usage-hold">{names[pendingReview.pendingReviewer ?? "claude"]} review pending</p>}
        <ReviewFreshness review={snapshot?.review} busy={busy} draftReview={draftReview} />
      </>}
      {error && <p className="live-error" role="alert">{error}</p>}
      {snapshot && <>
        <h3>Git status</h3>
        <pre className="file-preview">{snapshot.status || "Working tree clean"}</pre>
        <h3>Tracked patch</h3>
        <pre className="file-preview thread-patch">{snapshot.diff ? snapshot.diff.replace(/\r?\n$/u, "").split(/\r?\n/u).map((line, index) => {
          const kind = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("@@") ? "header"
            : line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : undefined;
          return <span key={index} className={kind}>{line}{"\n"}</span>;
        }) : "No tracked changes"}</pre>
        <p className="setting-detail">Git status also lists new files.</p>
      </>}
      <RunEvidence evidence={lastRun?.evidence} compact />
      {lane === "main" && <button className="button small thread-review-action" disabled={busy} onClick={() => draftReview()}>Review changes with {names[pendingReview?.pendingReviewer ?? "claude"]}</button>}
    </>
  );
}

export function LiveApp() {
  const api = window.aiDeck;
  const [state, setState] = useState({ workspace: null, connections: {}, recent: [] });
  const appearance = state.appearance ?? defaultAppearance;
  const lowMemory = state.lowMemory === true;
  const [page, setPage] = useState("workspace");
  const [pluginTab, setPluginTab] = useState("skills");
  const [commandPalette, setCommandPalette] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [settingsSection, setSettingsSection] = useState("general");
  const [settingsAgent, setSettingsAgent] = useState("codex");
  const [showProjects, setShowProjects] = useState(false);
  const [providerDetails, setProviderDetails] = useState({});
  const [resetNotice, setResetNotice] = useState("");
  const [usageError, setUsageError] = useState("");
  const [modelCatalogs, setModelCatalogs] = useState({});
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [modal, setModal] = useState(null);
  const [historyRun, setHistoryRun] = useState(null);
  const [librarySkill, setLibrarySkill] = useState(null);
  const [inbox, setInbox] = useState({ rows: [], loading: true, error: "" });
  const [inboxRevision, setInboxRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queueNotice, setQueueNotice] = useState("");
  const [queueSetup, setQueueSetup] = useState(null);
  const [laneComparison, setLaneComparison] = useState(null);
  const [rows, setRows] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [usage, setUsage] = useState({});
  const [answer, setAnswer] = useState("");
  const [canSteer, setCanSteer] = useState(false);
  const [canFollowClaude, setCanFollowClaude] = useState(false);
  const [runScope, setRunScope] = useState(null);
  const [reviewFiles, setReviewFiles] = useState(null);
  const [continuationPreview, setContinuationPreview] = useState(null);
  const [acceptContinuationChanges, setAcceptContinuationChanges] = useState(false);
  const [baseUpdate, setBaseUpdate] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [quotaClock, setQuotaClock] = useState(Date.now);
  const [tab, setTab] = useState("outputs");
  const [taskPanelRevision, setTaskPanelRevision] = useState(0);
  const [panelSection, setPanelSection] = useState("outputs");
  const [panelDetail, setPanelDetail] = useState(null);
  const [inspector, setInspector] = useState(false);
  const [split, setSplit] = useState(false);
  const [diff, setDiff] = useState(null);
  const [diffRevision, setDiffRevision] = useState(0);
  const [lane, setLane] = useState("main");
  const draftInput = useRef(null);
  const drafts = useRef(new Map());
  const imageRequest = useRef(null);
  const windowCheckpoint = useRef(null);
  const runId = useRef(null);
  const sequence = useRef(0);
  const workspace = state.workspace;
  const taskId = workspace?.taskId;
  const diffLane = workspace?.claudeWorktree ? lane : "main";
  const worktree = diffLane === "claude" ? workspace?.claudeWorktree : workspace?.worktree;
  const runs = workspace?.runHistory ?? [];
  const lastFinished = runs.at(-1)?.finishedAt;
  const panelThumbnail = useCallback(async (id) => {
    try { return (await api["task-panel-item"]({ taskId, id, mode: "thumbnail" })).source; }
    catch { return null; }
  }, [api, taskId, lastFinished]);
  const library = state.skillLibrary ?? [];
  const pendingReview = runs.findLast((run) => run.reviewPending);
  const continuation = continuationFor(workspace);
  const latestPlanIssue = workspace?.runHistory?.at(-1)?.teamPlan?.state !== "ready" ? workspace?.runHistory?.at(-1) : null;
  const implementationReview = continuation && runs.find((run) => run.id === continuation.runId)?.teamPlan?.applyStatus;
  const canContinue = continuation && routeMode(continuation.mode, state.connections, quotaClock).available.length > 0;
  const repositories = state.recent.map((project) => project.repo === workspace?.repo
    ? { ...project, tasks: workspace.tasks, currentTask: taskId } : project);
  const locked = busy || working || Boolean(state.backgroundRun);
  windowCheckpoint.current = () => {
    if (locked || modal || ["scheduled", "context", "plugins", "settings"].includes(page) ||
        page === "workspace" && inspector && tab === "context") return null;
    const currentDrafts = new Map(drafts.current);
    if (taskId) currentDrafts.set(taskId, draft);
    return {
      taskId: taskId ?? null, lastRunId: runs.at(-1)?.id, drafts: [...currentDrafts], rows,
      page, tab, inspector, showProjects, split, lane, providerDetails, queueNotice,
    };
  };

  function hydrate(next, running = false, approvals = []) {
    const { rows: restored, statuses: last, answer: savedAnswer } = restoredActivity(next);
    const latest = next?.runHistory?.at(-1);
    runId.current = running ? latest?.id : null;
    setStartedAt(running ? latest?.startedAt : null);
    setRows([...restored, ...approvals.map((approval) => ({
      ...approval, id: latest.id + ":approval:" + approval.key, agent: approval.agent ?? "codex", kind: approval.type === "question" ? "question" : "approval",
    }))]);
    setStatuses(last);
    setUsage(next?.usage ?? {});
    setAnswer(savedAnswer);
    setQueueNotice("");
    setLane("main");
    setDraft(drafts.current.get(next?.taskId) ?? next?.savedDraft ?? { ...emptyDraft, mode: defaultDraftMode(next) });
  }

  useEffect(() => {
    if (!working || !startedAt) return;
    const start = Date.parse(startedAt);
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [working, startedAt]);

  useEffect(() => {
    const now = Date.now();
    const resets = Object.values(state.connections).map((connection) => connection.usageLimit?.resetAt).filter((value) => value > now);
    if (!resets.length) return;
    const timer = setTimeout(() => setQuotaClock(Date.now()), Math.min(2147483647, Math.min(...resets) - now + 25));
    return () => clearTimeout(timer);
  }, [state.connections, quotaClock]);

  useEffect(() => {
    if (!(page === "changes" || page === "workspace" && inspector && tab === "changes") || !worktree) return;
    let canceled = false;
    setDiff(null);
    void api.changes(diffLane).then((snapshot) => {
      if (!canceled) setDiff({ taskId, lane: diffLane, snapshot });
    }).catch((reason) => {
      if (!canceled) setDiff({ taskId, lane: diffLane, error: cleanError(reason) });
    });
    return () => { canceled = true; };
  }, [api, page, inspector, tab, taskId, worktree, lastFinished, diffRevision, diffLane]);

  useEffect(() => {
    if (!(page === "changes" || page === "workspace" && inspector && tab === "changes") || !worktree) return;
    const refresh = () => setDiffRevision((revision) => revision + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [page, inspector, tab, worktree]);

  useEffect(() => {
    const closeApprovals = (agent) => setRows((current) => current.map((row) =>
      ["approval", "question"].includes(row.kind) && !row.decision && (!agent || row.agent === agent) ? { ...row, decision: "Turn ended" } : row));
    function receive(data) {
      const { agent, type } = data;
      if (type === "prepare-tray-sleep") {
        void api["complete-tray-sleep"]({ token: data.token, view: windowCheckpoint.current() }).catch(() => {});
        return;
      }
      if (type === "state-changed") {
        setState(data.state);
        return;
      }
      if (data.workspace) setState((current) => ({ ...current, workspace: data.workspace }));
      if (type === "run-start") {
        runId.current = data.runId;
        setStartedAt(data.startedAt);
        setElapsed(0);
        setWorking(true);
        setCanSteer(false);
        setCanFollowClaude(false);
        setStatuses({});
        setQueueNotice("");
        setRows((current) => [...current, { id: data.runId + ":prompt", kind: "prompt", text: data.prompt, images: data.images, agents: data.agents }]);
      } else if (type === "finished") {
        setWorking(false);
        setCanSteer(false);
        setCanFollowClaude(false);
        closeApprovals();
      } else if (type === "queue-paused") setQueueNotice(data.text);
      else if (type === "handoff") setRows((current) => [...current, { id: runId.current + ":handoff:" + data.key, agent, kind: "activity", text: data.text }]);
      else if (type === "connections") setState((current) => ({ ...current, connections: data.connections }));
      else if (type === "error") setError(data.text);
      else if (type === "status") {
        setStatuses((current) => ({ ...current, [agent]: data.status }));
        if (closedStatuses.has(data.status)) {
          if (agent === "codex") setCanSteer(false);
          if (agent === "claude") setCanFollowClaude(false);
          closeApprovals(agent);
        }
      } else if (type === "stopped-if-active") {
        setStatuses((current) => activeStatuses.has(current[agent]) ? { ...current, [agent]: "interrupted" } : current);
      } else if (type === "steer-ready") {
        if (agent === "claude") setCanFollowClaude(data.ready === true);
        else setCanSteer(true);
      } else if (type === "approval-cancelled") {
        setRows((current) => current.map((row) => row.agent === agent && row.key === data.key ? { ...row, decision: "Request withdrawn" } : row));
      }
      else if (type === "usage") setUsage((current) => ({ ...current, [agent]: { ...data.usage, scope: data.scope } }));
      else if (type === "answer" && agent === "claude") setAnswer(data.text);
      else if (type === "limit") {
        const row = limitRow(runId.current + ":limit:" + ++sequence.current, agent, data.limit);
        setRows((current) => [...current, row]);
      } else if (type === "approval" || type === "question") {
        const row = { ...data, id: runId.current + ":approval:" + data.key, agent, kind: type };
        setRows((current) => [...current, row]);
      } else if (["delta", "message", "activity", "steered"].includes(type) && data.text) {
        const id = runId.current + ":" + agent + ":" + (data.key ?? "event-" + ++sequence.current);
        const kind = type === "delta" ? "message" : type;
        setRows((current) => {
          const previous = current.find((row) => row.id === id);
          const text = type === "delta" ? (previous?.text ?? "") + data.text : data.text;
          const row = { id, agent, kind, text: text.slice(-30000), ...(data.images && { images: data.images }) };
          return previous ? current.map((item) => item.id === id ? row : item) : [...current, row].slice(-320);
        });
      }
    }
    const unsubscribe = api.onEvent(receive);
    let disposed = false;
    void (async () => {
      const { windowResume, ...next } = await api.state();
      if (disposed) return;
      setState(next);
      setWorking(next.running);
      setCanSteer(next.canSteer);
      setCanFollowClaude(next.canFollowClaude);
      if (windowResume) drafts.current = new Map(windowResume.drafts);
      hydrate(next.workspace, next.running, next.approvals);
      if (windowResume && (next.workspace?.taskId ?? null) === windowResume.taskId) {
        setPage(windowResume.page);
        setTab(windowResume.tab);
        setInspector(windowResume.inspector);
        setShowProjects(windowResume.showProjects === true);
        setSplit(windowResume.split);
        setLane(windowResume.lane);
        setProviderDetails(windowResume.providerDetails ?? {});
        if (!next.running && next.workspace?.runHistory?.at(-1)?.id === windowResume.lastRunId) {
          setRows(windowResume.rows);
          setQueueNotice(windowResume.queueNotice);
        }
      }
      if ((!next.connections.codex?.status || !next.connections.claude?.status) && !next.running && !next.backgroundRun) {
        const connected = await api.connections();
        if (!disposed) setState((current) => ({ ...current, connections: connected.connections }));
      }
    })().catch((reason) => { if (!disposed) setError(cleanError(reason)); });
    return () => { disposed = true; unsubscribe(); };
  }, [api]);

  useEffect(() => {
    if (page !== "inbox") return;
    let disposed = false;
    setInbox((current) => ({ ...current, loading: true, error: "" }));
    void api["team-inbox"]().then((rows) => {
      if (!disposed) setInbox({ rows, loading: false, error: "" });
    }).catch((reason) => {
      if (!disposed) setInbox((current) => ({ ...current, loading: false, error: cleanError(reason) }));
    });
    return () => { disposed = true; };
  }, [api, page, inboxRevision, taskId, lastFinished, working, state.backgroundRun]);

  async function perform(command, payload, reportError = setError) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const next = await api[command](payload);
      if (next?.connections) setState(next);
      else if (command === "save-appearance" && next?.appearance) setState((current) => ({ ...current, appearance: next.appearance }));
      return next;
    } catch (reason) {
      reportError(cleanError(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function open(command, payload, destination = "workspace") {
    if (taskId) drafts.current.set(taskId, draft);
    const next = await perform(command, payload);
    if (next?.workspace) {
      if (next.workspace.taskId !== taskId) hydrate(next.workspace);
      setPage(destination);
      if (window.innerWidth < 880 && destination === "workspace") setShowProjects(false);
    }
    return next;
  }

  async function loadProviderDetails(agent) {
    if (agent === "codex") setResetNotice("");
    setUsageError("");
    const result = await perform("provider-details", agent, setUsageError);
    if (result) {
      setState(result.state);
      setProviderDetails((current) => ({ ...current, [agent]: result.detail }));
    } else setProviderDetails((current) => ({ ...current, [agent]: undefined }));
  }

  async function useCodexReset(token) {
    setUsageError("");
    const result = await perform("codex-reset-usage", token, setUsageError);
    if (result?.outcome === "cancelled") return;
    if (result?.state) setState(result.state);
    setProviderDetails((current) => ({ ...current, codex: result?.detail }));
    const messages = {
      reset: "Codex used one earned reset credit.",
      alreadyRedeemed: "Codex confirmed that the previous reset completed.",
      nothingToReset: "Codex found no eligible quota window to reset.",
      noCredit: "Codex reported no earned reset credit available.",
      offerChanged: "The available reset changed. Review the refreshed offer.",
      unconfirmed: "The result is unconfirmed. Refresh Codex and check the previous reset.",
    };
    const message = messages[result?.outcome] ?? "";
    setResetNotice(message + (result?.refreshNeeded ? " Refresh Codex to see the current limits." : ""));
  }

  async function loadModels(agent, refresh = false) {
    const catalog = await perform("provider-models", { agent, refresh });
    if (catalog) setModelCatalogs((current) => ({ ...current, [agent]: catalog }));
  }

  function showAgentModels(agent) {
    setError("");
    setNotice("");
    setModal(agent + "-model");
    if (!locked && !modelCatalogs[agent] && state.connections[agent]?.status === "ready") void loadModels(agent);
  }

  function modelSettings(agent, popup = false) {
    return <AgentModelSettings key={agent + (workspace?.taskId ?? "")} agent={agent} workspace={workspace}
      defaults={state.agentSettings} catalog={modelCatalogs[agent]} busy={busy}
      canLoad={!locked && state.connections[agent]?.status === "ready"} load={() => loadModels(agent, true)}
      save={async (payload) => {
        if (await perform("save-agent-settings", payload)) {
          if (popup) close();
          setNotice(names[agent] + " settings saved for future runs.");
          return true;
        }
        return false;
      }} />;
  }

  function modelButton(agent) {
    const label = agentModelLabel(effectiveAgentSettings(state.agentSettings, workspace, agent), modelCatalogs[agent]);
    const scope = workspace?.agentModels?.[agent] ? "This task" : workspace?.models?.[agent] ? "This project" : "AI Deck default";
    return <button key={agent} className="button small thread-model-picker" type="button" aria-label={names[agent] + " model and effort"}
      title={names[agent] + " · " + label + " · " + scope} disabled={busy} onClick={() => showAgentModels(agent)}>
      <Brand agent={agent} size={14} /><strong>{names[agent]}</strong><span>{label}</span><IconChevronDown size={13} />
    </button>;
  }

  const modelAgent = modal === "codex-model" ? "codex" : modal === "claude-model" ? "claude" : null;

  const now = Date.now();
  const { available, limited, disconnected, requested } = routeMode(draft.mode, state.connections, now);
  const fallback = singleAgentFallback(draft.mode, state.connections, now);
  const hasWriteConflict = (mode, agents) => Boolean(workspace?.readOnly && (!planPair(mode) && agents.includes("claude") && agentRole(mode, "claude") === "write"));
  const readOnlyConflict = hasWriteConflict(draft.mode, requested);
  const ready = available.length > 0 && !readOnlyConflict;
  const hasDraft = Boolean(draft.prompt.trim() || draft.images?.length);
  const teamPlan = effectiveTeamwork(draft.teamwork, workspace?.teamAssignment, workspace?.teamwork);
  const skills = workspace?.notes.filter((note) => note.source === "Skill") ?? [];
  const draftSkills = draft.skillIds ?? [];
  const pair = planPair(draft.mode);
  const planHint = pair && (limited.includes(pair[0]) ? names[pair[0]] + " needs usage before this workflow can start."
    : limited.includes(pair[1]) ? names[pair[0]] + " will plan now. Apply the plan when " + names[pair[1]] + " is available."
      : names[pair[0]] + " plans read-only. You approve the plan before " + names[pair[1]] + " starts.");
  const routeHint = disconnected.length ? "Check Connections for " + disconnected.map((agent) => names[agent]).join(" and ") + "."
    : readOnlyConflict ? "Project read-only mode is enabled. Choose Plan or Review to continue."
    : planHint ?? (
      !ready ? "Selected agents are at their usage limit. Your draft is ready when they are."
      : separateEdits(draft.mode) ? lowMemory && available.length === 2
        ? requested.map((agent) => names[agent]).join(" then ") + ". Each writer edits its own worktree." : "Each available writer edits its own worktree."
      : ["claude-build-review", "claude-team"].includes(draft.mode) ? limited.includes("claude") ? "Codex will review read-only while Claude is limited."
        : limited.includes("codex") ? "Claude will edit. The Codex review will stay pending."
          : draft.mode === "claude-build-review" ? "Claude edits first. Codex reviews the resulting changes."
            : lowMemory ? "Claude runs first. Codex reviews the snapshot from before the run." : "Codex reviews the initial snapshot while Claude edits."
      : limited.includes("claude") ? "Codex will continue. The Claude review will stay pending."
        : limited.includes("codex") ? "Claude will review read-only. Codex is at its usage limit."
          : draft.mode === "build-review" ? "Codex builds first. Claude reviews the resulting changes."
            : lowMemory && draft.mode === "team" ? "Codex runs first. Claude uses the review input captured before the run."
              : "Ctrl+Enter to send · / for commands");

  const slash = parseSlash(draft.prompt);
  const commandsOpen = !modal && (commandPalette === "manual" || Boolean(slash && commandPalette !== "dismissed"));
  const matchingCommands = slashCommands.filter((command) => !slash || (slash.args ? command.name === slash.name : command.name.startsWith(slash.name)));
  const highlighted = Math.min(commandIndex, matchingCommands.length - 1);
  const commandReason = (command) => command.project && !workspace ? "Open a repository first."
    : command.codexThread && !workspace?.codexThread ? "Start a Codex session first."
      : (command.idle || command.codexThread || command.name === "scope") && locked ? "Available when the current run is idle." : null;

  function toggleSkill(id) {
    setDraft((current) => {
      const selected = current.skillIds ?? [];
      return { ...current, skillIds: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] };
    });
  }

  function executeCommand(command) {
    const unavailable = commandReason(command);
    if (unavailable) { setError(unavailable); return; }
    const args = slash?.args ?? "";
    const selectedAgent = requested.length === 1 ? requested[0] : "codex";
    let mode = command.mode;
    if (command.name === "plan" || command.name === "review") {
      mode = command.name === "plan" ? selectedAgent + "-plan" : selectedAgent === "claude" ? "claude" : "codex-review";
    }
    setCommandPalette("dismissed");
    setError("");
    if (command.name === "skill" && args) {
      const matches = skills.filter((skill) => skill.name.toLowerCase() === args.trim().toLowerCase());
      if (matches.length !== 1) {
        setDraft((current) => ({ ...current, prompt: "" }));
        setError("Choose a matching skill from the picker.");
        setModal("skills");
        return;
      }
      const [skill] = matches;
      setDraft((current) => ({ ...current, prompt: "", skillIds: skill.enabled ? current.skillIds :
        [...new Set([...(current.skillIds ?? []), skill.id])] }));
      setNotice("Skill ready for this draft · " + skill.name);
      return;
    }
    setDraft((current) => ({ ...changeWorkflow(current, mode || current.mode), prompt: slash ? args : current.prompt }));
    if (mode) { draftInput.current?.focus(); return; }
    if (command.name === "team-plan") setModal("teamwork");
    else if (command.name === "skill") setModal("skills");
    else if (command.name === "skills") openPlugins("skills");
    else if (command.name === "library") openPlugins("library");
    else if (command.name === "inbox") go("inbox");
    else if (command.name === "model") openSettings("models");
    else if (command.name === "usage") go("usage");
    else if (command.name === "status") openSettings("connections");
    else if (command.name === "diff") go("changes");
    else if (command.name === "scope") void inspectRun("scope");
    else if (command.name === "goal") setModal("codex");
    else if (command.name === "new") void open("new-task");
  }

  function composerKey(event) {
    if (event.nativeEvent.isComposing) return;
    if (commandsOpen && event.key === "Escape") {
      event.preventDefault();
      setCommandPalette("dismissed");
    } else if (commandsOpen && matchingCommands.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCommandIndex((highlighted + step + matchingCommands.length) % matchingCommands.length);
    } else if (commandsOpen && event.key === "Enter" && !event.shiftKey && matchingCommands[highlighted]) {
      event.preventDefault();
      executeCommand(matchingCommands[highlighted]);
    } else if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form.requestSubmit();
    }
  }

  async function startDraft(mode) {
    if (slash && commandPalette !== "dismissed") {
      const command = slashCommands.find((item) => item.name === slash.name);
      if (command) executeCommand(command);
      else { setError("Choose an AI Deck command, or press Escape to send the text as a message."); setCommandPalette(null); }
      return;
    }
    const prompt = draft.prompt.trim();
    const route = routeMode(mode, state.connections, now);
    if (busy || state.backgroundRun || !workspace || !hasDraft || hasWriteConflict(mode, route.requested) || (!working && !route.available.length)) return;
    const next = await perform(working ? "queue-message" : "run", { ...changeWorkflow(draft, mode), prompt });
    if (next) setDraft((current) => {
      if (current.prompt.trim() !== prompt || current.mode !== draft.mode || current.teamwork !== draft.teamwork ||
          current.assignmentOnce !== draft.assignmentOnce) return current;
      const after = current.assignmentOnce ? { mode: defaultDraftMode(workspace), teamwork: undefined, assignmentOnce: undefined } : {};
      return { ...current, ...after, prompt: "", reviewOf: null, reviewSince: undefined, reviewFiles: undefined, reviewTarget: undefined, images: undefined, skillIds: undefined };
    });
  }

  function applyTeamDraft(mode, teamwork, once = false) {
    setDraft((current) => ({ ...changeWorkflow(current, mode), teamwork, assignmentOnce: once || undefined }));
    close();
  }

  async function saveTeamSession(mode, teamwork, reset = false) {
    const next = await perform("save-team-assignment", { taskId, mode, teamwork, reset });
    if (next) {
      applyTeamDraft(reset ? workspace.teamMode ?? "team" : mode, undefined);
      setNotice(reset ? "Session uses the project default." : "Roles saved for this session.");
    }
  }

  async function inspectRun(kind) {
    if (kind === "scope") {
      setRunScope(null);
      setModal("scope");
      setRunScope(await perform("run-scope", { mode: draft.mode, teamwork: draft.teamwork, skillIds: draft.skillIds }));
    } else {
      setReviewFiles(null);
      setModal("files");
      setReviewFiles(await perform("review-files"));
    }
  }

  async function decide(row, accept) {
    const acknowledged = await perform("approve", { key: row.key, agent: row.agent, accept });
    if (acknowledged) setRows((current) => current.map((item) =>
      item.id === row.id ? { ...item, decision: accept ? "Approved once" : "Declined" } : item));
  }

  async function answerQuestion(row, answers) {
    const acknowledged = await perform("answer-question", { key: row.key, agent: row.agent, answers });
    if (acknowledged) setRows((current) => current.map((item) =>
      item.id === row.id ? { ...item, decision: answers === null ? "Questions skipped" : "Answers sent" } : item));
  }

  async function openInboxRow(row) {
    const next = await open("switch-task", { repo: row.repo, id: row.taskId });
    if (next?.workspace?.taskId === row.taskId && (row.kind === "approval" || row.kind === "plan-input")) {
      setHistoryRun(row.runId);
      setModal("history");
    }
  }

  async function previewLibrarySkill(entry) {
    setLibrarySkill(null);
    setModal("library");
    setLibrarySkill(await perform("skill-library-read", { id: entry.id, revision: entry.revision }));
  }

  async function changeLibrarySkill(action) {
    const next = await perform("skill-library-edit", { action, id: librarySkill.id, revision: librarySkill.revision, repo: workspace?.repo });
    if (next) {
      close();
      setNotice(action === "remove" ? "Library entry removed." : "Saved v" + librarySkill.revision + " in " + projectName(workspace.repo) + ".");
    }
  }

  async function compareWorktrees() {
    setLaneComparison(null);
    setModal("compare");
    setLaneComparison(await perform("compare-worktrees"));
  }

  async function reviewQueue(forcePreview = false) {
    const next = await perform("queue-preview");
    if (!next) return;
    if (!forcePreview && !next.changes.length) { await perform("run-next", { id: next.id, stamp: next.stamp }); return; }
    setQueueSetup(next);
    setModal("queue");
  }

  async function previewContinuation(selected = continuation) {
    setContinuationPreview(null);
    setAcceptContinuationChanges(false);
    setModal("continue");
    setContinuationPreview(await perform("preview-continuation", selected.runId));
  }

  function clarifyPlan(run) {
    const text = run.teamPlan.text;
    close();
    fillDraft({ ...changeWorkflow(draft, run.mode), teamwork: run.teamwork ?? {}, assignmentOnce: true, images: run.images,
      prompt: "Revise the plan for this task.\n\nOriginal task:\n" + run.prompt.slice(0, 5000) +
        (text ? "\n\nPrevious plan or questions:\n" + text : "") + "\n\nMy clarification:\n",
      skillIds: run.skillIds?.filter((id) => skills.some((skill) => skill.id === id)) });
  }

  function fillDraft(next) {
    setDraft(next);
    setPage("workspace");
    requestAnimationFrame(() => draftInput.current?.focus());
  }

  async function attachText() {
    const attachment = await perform("choose-text-attachment");
    if (!attachment) return;
    const prompt = [draft.prompt.trim(), `[Attached text · ${attachment.name}]\n${attachment.text}`].filter(Boolean).join("\n\n");
    if (prompt.length > 18000) { setError("This draft has no room for the attachment."); return; }
    fillDraft({ ...draft, prompt });
  }

  function addImages(images) {
    if (images?.length) setDraft((current) => ({ ...current, images: [...(current.images ?? []), ...images].slice(0, 4) }));
  }

  async function attachImages() {
    addImages(await perform("choose-task-images", 4 - (draft.images?.length ?? 0)));
  }

  async function pasteImages(event) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    if (busy || !workspace) return;
    if (files.length + (draft.images?.length ?? 0) > 4) { setError("Attach up to four images."); return; }
    if (files.some((file) => file.size > 12 * 1024 * 1024)) { setError("Image files can be up to 12 MB."); return; }
    setError("");
    setBusy(true);
    try {
      for (const file of files) {
        const image = await api["paste-task-image"]({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        addImages([image]);
      }
    } catch (reason) {
      setError(cleanError(reason));
    } finally { setBusy(false); }
  }

  async function updateTaskPanel(payload) {
    const result = await perform("task-panel-change", { taskId, ...payload });
    if (result?.updated) {
      setTaskPanelRevision((value) => value + 1);
      if (payload.action !== "remove") close();
    }
  }

  async function openTaskPanel(item) {
    if (item.kind === "image") {
      const request = {};
      imageRequest.current = request;
      setImagePreview(null);
      setModal("image");
      const result = await perform("task-panel-item", { taskId, id: item.id, mode: "preview" });
      if (result?.source && imageRequest.current === request) setImagePreview({ name: item.name, source: result.source });
    } else if (item.kind === "link" || item.manual) {
      await perform("task-panel-item", { taskId, id: item.id, mode: "open" });
    } else {
      setError("");
      setNotice("");
      setPanelDetail(item);
      setModal("panel-detail");
    }
  }

  async function previewImage(image) {
    const request = {};
    imageRequest.current = request;
    setImagePreview(null);
    setModal("image");
    const source = await perform("preview-task-image", image.id);
    if (source && imageRequest.current === request) setImagePreview({ name: image.name, source });
  }

  function removeDraftImage(id) {
    setDraft((current) => ({ ...current, images: current.images?.filter((image) => image.id !== id) }));
    void api["discard-draft-image"](id).catch(() => {});
  }

  function draftReview(changed) {
    if (changed) {
      const previous = runs.find((run) => run.id === changed.runId);
      fillDraft({ assignmentOnce: true, teamwork: previous?.teamwork ?? {}, mode: changed.snapshot.reviewer === "codex" ? "codex-review" : "claude", reviewOf: null, reviewSince: changed.runId,
        reviewFiles: changed.snapshot.selection?.selectedFiles,
        prompt: "Review only the files changed since the previous review. Report regressions, removals and missing evidence." });
      return;
    }
    fillDraft({
      mode: pendingReview?.pendingReviewer === "codex" ? "codex-review" : "claude", reviewOf: pendingReview?.id ?? null,
      images: pendingReview?.images, assignmentOnce: true, teamwork: pendingReview?.teamwork ?? {},
      skillIds: pendingReview?.skillIds?.filter((id) => skills.some((skill) => skill.id === id)),
      prompt: "Review the current Git diff. List actionable findings with evidence and note any missing context." +
        (pendingReview ? "\n\nOriginal task:\n" + pendingReview.prompt.slice(0, 17000) : ""),
    });
  }

  function writerHandoffDraft(run, source) {
    const target = source === "codex" ? "claude" : "codex";
    const owner = run?.agents[source] && agentRole(run.mode, source) === "write" ? source
      : run?.agents[target] && agentRole(run.mode, target) === "write" ? target : undefined;
    return { mode: target === "claude" ? "claude-write" : "codex", reviewOf: null, assignmentOnce: true,
      teamwork: handoffTeamwork(run?.teamwork, owner, target), images: run?.images,
      skillIds: run?.skillIds?.filter((id) => skills.some((skill) => skill.id === id)) };
  }

  const action = (payload) => perform("configure", payload);
  const retry = (agent) => perform("clear-usage-hold", agent);
  const close = () => { imageRequest.current = null; setModal(null); setImagePreview(null); setBaseUpdate(null); setError(""); setNotice(""); };
  const showInspector = (next) => {
    setPage("workspace");
    setTab(next);
    setInspector(true);
    if (window.innerWidth < 880) setShowProjects(false);
  };
  const openProvider = (key) => perform("provider-page", key);
  function go(next) {
    setError("");
    setNotice("");
    setCommandPalette("dismissed");
    setPage(next);
  }
  function openPlugins(section = "skills") {
    setPluginTab(section);
    go("plugins");
  }
  function pickSettingsAgent(agent) {
    setSettingsAgent(agent);
    setNotice("");
    if (!locked && !modelCatalogs[agent] && state.connections[agent]?.status === "ready") void loadModels(agent);
  }
  function openSettings(section = settingsSection) {
    go("settings");
    setSettingsSection(section);
    if (section === "models") pickSettingsAgent(settingsAgent);
  }
  function toggleProjects() {
    if (page !== "workspace") {
      go("workspace");
      setShowProjects(true);
    } else setShowProjects(!showProjects);
    if (window.innerWidth < 880) setInspector(false);
  }
  const visibleDiff = diff?.taskId === taskId && diff?.lane === diffLane ? diff : null;
  const workspacePage = page === "workspace";
  const projectScope = workspace ? projectName(workspace.repo) : "Workspace";
  const openRepoHere = () => open("choose-repo", undefined, page);
  const usagePanel = () => <Usage reported={usage} runs={runs} connections={state.connections} now={now} busy={locked}
    retry={retry} details={providerDetails} load={loadProviderDetails} openProvider={openProvider}
    reset={useCodexReset} resetNotice={resetNotice} usageError={usageError} />;
  const contextPanel = (full) => <Context key={workspace?.repo} workspace={workspace} busy={locked} action={action}
    importNote={(source) => perform("import-context", source)} importProject={() => perform("import-project-context")}
    openPlugins={() => openPlugins("mcp")} full={full} />;
  const changesPanel = () => <ChangesPanel workspace={workspace} worktree={worktree} lane={diffLane} chooseLane={setLane} snapshot={visibleDiff?.snapshot}
    error={visibleDiff?.error} loading={!visibleDiff}
    refresh={() => setDiffRevision((value) => value + 1)} openWorktree={() => perform("open-worktree", diffLane)} draftReview={draftReview}
    compare={compareWorktrees}
    updateBase={(base) => { setError(""); setBaseUpdate({ ...base, taskId, lane: diffLane }); setModal("base"); }}
    busy={locked} lastRun={runs.at(-1)} pendingReview={pendingReview} />;
  const connectionsPanel = () => <Connections state={state.connections} now={now} busy={locked} refresh={() => perform("connections")} choose={(agent) => perform("choose-cli", agent)}
    docs={(agent) => perform("docs", agent)} copy={async (agent) => { await perform("copy-login", agent); setNotice("Sign-in command copied."); }} retry={retry}
    test={(agent) => perform("test-provider", agent)} />;
  const pageFeedback = <>{error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="review-complete" role="status">{notice}</p>}</>;
  return (
    <main className="thread-app" style={{ "--text-scale": appearance.textScale / 100 }}>
      <header className="thread-top">
        <div className="thread-actions">
          <button className="button small deck-projects-toggle" aria-label="Toggle projects" title="Projects and recent tasks" aria-pressed={workspacePage && showProjects}
            aria-controls="deck-project-sidebar" onClick={toggleProjects}><IconLayoutSidebar size={16} />Projects</button>
          <div className="thread-brand"><IconStack2 size={23} stroke={2.4} /><strong>AI Deck</strong></div>
        </div>
        <div className="thread-actions">
          {working && !workspacePage && <button className="button small" onClick={() => go("workspace")}>Run in progress</button>}
          {state.backgroundRun && <button className="button small" onClick={() => go("scheduled")}>Scheduled run active</button>}
          <button className="button small deck-low-memory" type="button" aria-label="Low RAM" aria-pressed={lowMemory}
            title="Run one agent at a time" disabled={locked || typeof state.lowMemory !== "boolean"}
            onClick={() => perform("save-low-memory", !lowMemory)}><IconCpu size={15} />Low RAM {lowMemory ? "on" : "off"}</button>
          <button className="button small" onClick={() => openSettings("connections")}><IconPlug size={15} />Connections</button>
          <button className="icon-button" aria-label="Team settings" title="Team settings" onClick={() => openSettings()}><IconSettings size={19} /></button>
        </div>
      </header>
      <div className={["thread-layout", workspacePage && showProjects && "with-projects", workspacePage && inspector && "with-inspector"].filter(Boolean).join(" ")}>
        <DeckNav current={page} go={(next) => next === "settings" ? openSettings() : next === "plugins" ? openPlugins() : go(next)} />
        {workspacePage && showProjects && <Sidebar repositories={repositories} workspace={workspace} busy={locked} openRepo={openRepoHere}
          openTask={(repo, id) => { if (id !== taskId) void open("switch-task", { repo, id }); else if (window.innerWidth < 880) setShowProjects(false); }} newTask={() => open("new-task")} />}
        <WorkbenchPage title="Team settings" scope="AI Deck" description="Set up your device, agents and project." hidden={page !== "settings"}
          actions={<button className="button small" onClick={() => go("workspace")}>Back to workspace</button>}>
          <nav className="deck-settings-tabs" aria-label="Settings sections">
            {Object.entries(settingsTabs).map(([key, label]) => <button key={key} type="button" aria-current={settingsSection === key ? "page" : undefined}
              onClick={() => openSettings(key)}>{label}</button>)}
          </nav>
          {page === "settings" && pageFeedback}
          {page === "settings" && settingsSection === "general" && <PerformanceSettings enabled={lowMemory} closeToTray={state.closeToTray === true}
            locked={locked || typeof state.lowMemory !== "boolean"} change={(enabled) => perform("save-low-memory", enabled)}
            changeTray={(enabled) => perform("save-close-to-tray", enabled)} quit={() => perform("quit-app")} readMemory={api["system-memory"]} />}
          {page === "settings" && settingsSection === "appearance" && <Appearance value={appearance} busy={busy} change={(value) => perform("save-appearance", value)} />}
          {page === "settings" && settingsSection === "models" && <div className="deck-box deck-model-settings">
            <div className="thread-segments" role="group" aria-label="Model provider">
              {Object.entries(names).map(([agent, name]) => <button key={agent} aria-pressed={settingsAgent === agent} disabled={busy}
                onClick={() => pickSettingsAgent(agent)}><Brand agent={agent} size={14} />{name}</button>)}
            </div>
            {modelSettings(settingsAgent)}
          </div>}
          <div hidden={settingsSection !== "project"}>
            <p className="deck-project-scope setting-detail">{workspace ? "Current project · " + projectScope : "Project settings"}</p>
            {workspace && <div className="live-buttons deck-project-scope">
              <button className="button small" onClick={() => { setError(""); setNotice(""); setModal("teamwork"); }}>Edit team plan</button>
            </div>}
            {workspace
              ? <ProjectSettings key={workspace.repo} workspace={workspace} busy={locked}
                action={async (payload) => { if (await action(payload)) setNotice("Project settings saved."); }} />
              : <ProjectEmpty message="Open a Git repository to set shared instructions and access for both agents." choose={openRepoHere} busy={locked} />}
          </div>
          {page === "settings" && settingsSection === "connections" && connectionsPanel()}
        </WorkbenchPage>
        {page === "inbox" && <TeamInbox {...inbox} error={error || inbox.error} busy={locked} connections={state.connections} now={now}
          refresh={() => { setError(""); setInboxRevision((current) => current + 1); }} open={openInboxRow} />}
        {page === "usage" && <WorkbenchPage title="Usage" scope="AI Deck" description="Account quota, credits, billing and task reports.">{usagePanel()}</WorkbenchPage>}
        {page === "context" && <WorkbenchPage title="Knowledge" scope={projectScope} description="Share notes and skill instructions with both agents."
          actions={workspace && <button className="button small" onClick={() => openPlugins("mcp")}>Open plugins</button>}>
          {pageFeedback}
          {workspace ? contextPanel(true) : <ProjectEmpty message="Choose a repository to import notes, skills and instructions." choose={openRepoHere} busy={locked} />}
        </WorkbenchPage>}
        {page === "plugins" && <WorkbenchPage title="Skills & plugins" scope={projectScope} description="Share skills and configure tools for both agents."
          actions={workspace && <button className="button small" onClick={() => go("context")}>Open knowledge</button>}>
          {pageFeedback}
          <nav className="deck-settings-tabs" aria-label="Skills and plugins sections">
            <button aria-current={pluginTab === "skills" ? "page" : undefined} onClick={() => setPluginTab("skills")}>Shared skills</button>
            <button aria-current={pluginTab === "library" ? "page" : undefined} onClick={() => setPluginTab("library")}>Local library</button>
            <button aria-current={pluginTab === "mcp" ? "page" : undefined} onClick={() => setPluginTab("mcp")}>MCP servers</button>
          </nav>
          {pluginTab === "library" ? <LocalSkillLibrary library={library} skills={skills} projects={repositories} workspace={workspace} busy={locked}
            pickProject={(repo) => open("switch-repo", repo, "plugins")} choose={openRepoHere} preview={previewLibrarySkill} />
            : !workspace ? <ProjectEmpty message="Choose a repository to add shared skills or manage its MCP servers." choose={openRepoHere} busy={locked} />
            : pluginTab === "skills" ? <SharedSkills key={workspace.repo} skills={skills} library={library} repo={workspace.repo} busy={locked} action={action}
              importSkill={() => perform("import-context", "Skill")} openLibrary={() => setPluginTab("library")}
              publish={async (id) => {
                if (await perform("skill-library-edit", { action: "publish", id, repo: workspace.repo })) setNotice("Saved the current skill in the local library.");
              }} />
              : <Plugins key={workspace.repo} workspace={workspace} busy={locked} action={action} />}
        </WorkbenchPage>}
        {page === "changes" && <WorkbenchPage title="Git & Review" scope={projectScope} description={workspace ? workspace.title : "Inspect worktrees, diffs and review evidence."}>
          {pageFeedback}
          {workspace ? changesPanel() : <ProjectEmpty message="Open a repository to inspect worktree changes and reviews." choose={openRepoHere} busy={locked} />}
        </WorkbenchPage>}
        {page === "scheduled" && <Scheduled schedules={state.schedules ?? []} projects={repositories} workspace={workspace} lowMemory={lowMemory}
          background={state.backgroundRun} busy={busy} interactive={working} error={error}
          action={perform} openTask={(repo, id) => open("switch-task", { repo, id })} openProvider={openProvider} openRepo={openRepoHere} />}
        {page === "features" && <FeatureMap go={go} openProvider={openProvider} error={error} />}
        {workspacePage && <section className="thread-main">
          <header className="thread-taskbar">
            <div className="thread-title">
              <div>{workspace ? projectName(workspace.repo) : "Workspace"}</div>
              <h1 title={workspace?.title}>{workspace?.title ?? "Team workspace"}</h1>
            </div>
            <div className="thread-actions">
              {!workspace && <button className="button small primary" disabled={locked} onClick={openRepoHere}><IconFolder size={15} />Open repository</button>}
              {workspace && !showProjects && <button className="icon-button" aria-label="New task" title="New task" disabled={locked}
                onClick={() => open("new-task")}><IconPlus size={17} /></button>}
              <div className="thread-segments" aria-label="Activity view">
                <button aria-pressed={!split} onClick={() => setSplit(false)}><IconListDetails size={15} />Timeline</button>
                <button aria-pressed={split} onClick={() => setSplit(true)}><IconLayoutColumns size={15} />Split</button>
              </div>
              <button className="icon-button" aria-label="Run history" title="Run history" disabled={!runs.length} onClick={() => { setHistoryRun(null); setModal("history"); }}><IconHistory size={18} /></button>
              {workspace?.codexThread && <button className="icon-button" aria-label="Codex session" title="Codex goal and fork" onClick={() => setModal("codex")}><IconTarget size={18} /></button>}
              <button className="icon-button" aria-label="Inspector" title="Toggle inspector" aria-pressed={inspector} aria-controls="thread-inspector"
                onClick={() => { if (inspector) setInspector(false); else showInspector(tab); }}><IconLayoutSidebarRight size={20} /></button>
            </div>
          </header>
          <div className="thread-statusbar">
            {Object.entries(names).map(([agent, name]) => {
              const connection = state.connections[agent];
              const hold = activeUsageLimit(connection?.usageLimit, now);
              const live = activeStatuses.has(statuses[agent]);
              return <button key={agent} className={`thread-provider ${agent}${hold ? " limited" : ""}`} onClick={() => go("usage")}>
                <Brand agent={agent} size={16} /><strong>{name}</strong><span>{
                  live ? statusLabels[statuses[agent]]
                    : hold || !statuses[agent] || statuses[agent] === "limited" || connection?.status !== "ready"
                      ? connectionLabel(connection, now) : statusLabels[statuses[agent]]
                }</span>
              </button>;
            })}
            {working && <span className="thread-elapsed">Working · {elapsed}s</span>}
            {workspace?.base && <span className="thread-base" title="Worktree base revision"><IconGitBranch size={14} /><code>{workspace.base.slice(0, 8)}</code></span>}
          </div>
          <Activity split={split} taskId={taskId} rows={rows} busy={busy} decide={decide} answer={answerQuestion} preview={previewImage} />
          <div className="thread-compose-wrap">
            {!modal && error && <p className="live-error" role="alert">{error}</p>}
            {queueNotice && workspace?.queue.length > 0 && <p className="thread-queue-note" role="status">{queueNotice}</p>}
            {continuation && !working && <div className="thread-pending">
              <span>{implementationLabels[implementationReview] ?? (continuation.kind === "apply-plan" ? "Claude plan ready" : continuation.kind === "apply-team-plan"
                ? names[continuation.from] + " plan ready for " + names[continuation.agent] : names[continuation.from] + " hit a usage limit")}
                {!implementationReview && !canContinue && " · " + names[continuation.agent] + " unavailable"}</span>
              {planResultCanBeConfirmed(implementationReview)
                ? <button className="button small" disabled={locked} onClick={() => { setHistoryRun(continuation.runId); setModal("history"); }}>Review implementation</button>
                : <button className="button small" disabled={locked} onClick={() => previewContinuation()}>
                  {continuation.kind === "usage-handoff" ? "Review handoff" : "Review plan to apply"}</button>}
            </div>}
            {latestPlanIssue?.teamPlan && !working && <div className="thread-pending">
              <span>{names[latestPlanIssue.teamPlan.from]} · {planStatus[latestPlanIssue.teamPlan.state]}</span>
              <button className="button small" disabled={locked} onClick={() => clarifyPlan(latestPlanIssue)}>Clarify or replan</button>
            </div>}
            {pendingReview && <div className="thread-pending">
              <span>{names[pendingReview.pendingReviewer ?? "claude"]} review pending</span><button className="button small" disabled={locked} onClick={() => draftReview()}>Draft pending review</button>
            </div>}
            <Queue items={workspace?.queue ?? []} working={working} activeMode={working ? runs.at(-1)?.mode : null} canSteer={canSteer} canFollowClaude={canFollowClaude} lowMemory={lowMemory}
              busy={busy || Boolean(state.backgroundRun)} preview={previewImage}
              next={() => reviewQueue()} steer={(id, agent) => perform("steer-queued", { id, agent })} remove={(id) => perform("remove-queued", id)} />
            {workspace && !working && disconnected.some((agent) => state.connections[agent]?.status) && <div className="thread-pending thread-recovery">
              <span>{disconnected.map((agent) => names[agent]).join(" and ")} · {disconnected.length === 1 ? connectionLabel(state.connections[disconnected[0]], now) : "Connections needed"}</span>
              <div className="thread-actions">
                <button className="button small" onClick={() => openSettings("connections")}>Open connections</button>
                {fallback && <button className="button small primary" type="button"
                  disabled={locked || !hasDraft || Boolean(workspace.readOnly && fallback.mode === "claude-write")}
                  onClick={() => startDraft(fallback.mode)}>Run {names[fallback.agent]} only</button>}
              </div>
            </div>}
            <form className="thread-composer" onSubmit={(event) => { event.preventDefault(); void startDraft(draft.mode); }}>
              {commandsOpen && <CommandMenu commands={matchingCommands} selected={highlighted} choose={executeCommand} reason={commandReason} />}
              <textarea ref={draftInput} aria-label="Task message" aria-describedby="thread-hint" rows={2} maxLength={18000}
                aria-controls={commandsOpen ? "deck-command-options" : undefined}
                aria-activedescendant={commandsOpen && matchingCommands[highlighted] ? "deck-command-" + matchingCommands[highlighted].name : undefined}
                placeholder={workspace ? "Message your agents…" : "Open a Git repository to begin…"}
                value={draft.prompt} onChange={(event) => { setDraft({ ...draft, prompt: event.target.value }); setCommandPalette(null); setCommandIndex(0); }}
                onPaste={pasteImages} onKeyDown={composerKey} />
              <ImageChips images={draft.images} preview={previewImage} remove={removeDraftImage} busy={busy} />
              {draftSkills.length > 0 && <div className="deck-draft-skills" aria-label="Skills attached to draft">
                {draftSkills.map((id) => {
                  const label = skills.find((skill) => skill.id === id)?.name ?? "Unavailable skill";
                  return <button className="button small" type="button" key={id} aria-label={"Remove skill " + label} onClick={() => toggleSkill(id)}>
                    {label}<IconX size={13} /></button>;
                })}
              </div>}
              <div className="thread-compose-actions">
                <button className="button small deck-slash-button" type="button" aria-label="Slash commands" aria-pressed={commandsOpen}
                  onClick={() => { setCommandPalette(commandsOpen ? "dismissed" : "manual"); setCommandIndex(0); draftInput.current?.focus(); }}>/</button>
                <button className="icon-button" type="button" aria-label="Attach text file" title="Attach text file" disabled={busy || !workspace} onClick={attachText}><IconPaperclip size={17} /></button>
                <button className="icon-button" type="button" aria-label="Attach images" title="Attach PNG or JPEG, or paste a screenshot" disabled={busy || !workspace || draft.images?.length >= 4} onClick={attachImages}><IconPhoto size={17} /></button>
                <select aria-label="Agent mode" value={draft.mode} onChange={(event) => setDraft(changeWorkflow(draft, event.target.value))}>
                  {Object.keys(modeNames).map((key) => <option value={key} key={key}>{modeLabel(key, lowMemory)}</option>)}
                </select>
                <TeamPlanButton once={draft.assignmentOnce} active={Boolean(workspace?.teamAssignment?.mode || Object.values(teamPlan ?? {}).some(Boolean) || planPair(draft.mode))} onClick={() => { setError(""); setNotice(""); setModal("teamwork"); }} />
                {["codex", "claude"].map(modelButton)}
                {workspace && <button className="thread-text-button thread-compose-context" type="button" onClick={() => { setError(""); setModal("skills"); }}>
                  Skills {skills.filter((skill) => skill.enabled || draftSkills.includes(skill.id)).length}
                </button>}
                <button className="thread-text-button thread-compose-context" type="button" onClick={() => go("context")}>
                  Context {workspace?.notes.filter((note) => note.enabled && note.source !== "Skill").length ?? 0}
                </button>
                {workspace && <button className="thread-text-button thread-compose-context" type="button" disabled={locked} onClick={() => inspectRun("scope")}>Run scope</button>}
                {draft.reviewSince && <button className="button small" type="button" onClick={() => setDraft({ ...draft, reviewSince: undefined })}>
                  Changed files only <IconX size={13} /></button>}
                {workspace && ["claude", "codex-review"].includes(draft.mode) && !draft.reviewOf && !draft.reviewSince &&
                  <button className="thread-text-button thread-compose-context" type="button" disabled={busy} onClick={() => setModal("target")}>
                    {draft.reviewTarget ? "Review · " + draft.reviewTarget.ref.slice(0, 18) : "Review target"}
                  </button>}
                {workspace?.worktree && draft.reviewTarget?.type !== "commit" && ["team", "claude-team", "build-review", "claude-build-review", "claude", "codex-review"].includes(draft.mode) &&
                  <button className="thread-text-button thread-compose-context" type="button" disabled={locked}
                    onClick={() => inspectRun("files")}>Review files{draft.reviewFiles === undefined ? "" : " · " + draft.reviewFiles.length}</button>}
                <span className="thread-compose-context">{workspace?.readOnly ? "Read-only" : "Worktree"}</span>
                <div className="thread-actions">
                  {working && <button className="button small" type="button" disabled={busy} onClick={() => perform("stop")}><IconPlayerStop size={14} />Stop</button>}
                  <button className="button primary small" type="submit" disabled={commandsOpen && slash
                    ? !matchingCommands.some((command) => command.name === slash.name && !commandReason(command))
                    : busy || Boolean(state.backgroundRun) || !workspace || !hasDraft || readOnlyConflict || (!working && !ready)}>
                    {commandsOpen && slash ? "Command" : working ? "Queue" : "Send"}<IconArrowUp size={15} />
                  </button>
                </div>
              </div>
            </form>
            <div className="thread-hint">
              <span id="thread-hint">{!workspace ? "Choose a Git repository to start." : state.backgroundRun ? "A scheduled run is using the runner." : working ? "Follow-ups can be queued while agents work." : routeHint}</span>
              {answer && !working && <button className="thread-text-button" onClick={() => fillDraft({
                ...writerHandoffDraft(runs.findLast((run) => run.agents.claude?.answer === answer), "claude"),
                prompt: "Review these findings from Claude Code and address any supported issues in the worktree:\n\n" + answer.slice(0, 16000),
              })}>Draft Claude → Codex handoff</button>}
              {workspace && hasDraft && !working && <button className="thread-text-button" disabled={busy}
                onClick={async () => {
                  if (await perform("save-draft", draft)) setNotice("Draft saved for this task.");
                }}>{workspace.savedDraft?.prompt === draft.prompt.trim() && workspace.savedDraft?.mode === draft.mode ? "Update saved draft" : "Keep draft"}</button>}
            </div>
            {!modal && notice && <p className="thread-hint" role="status">{notice}</p>}
          </div>
        </section>}
        {workspacePage && inspector && <aside className="thread-inspector" id="thread-inspector" aria-label="Inspector">
          <div className="thread-inspector-header"><strong>Inspector</strong><div className="thread-actions">
            {tab !== "outputs" && <button className="button small" aria-label="Open full page" onClick={() => go(tab)}><IconArrowsMaximize size={14} />Expand</button>}
            <button className="icon-button" aria-label="Close inspector" onClick={() => setInspector(false)}><IconX size={17} /></button>
          </div></div>
          <div className="thread-inspector-tabs" aria-label="Inspector views">
            {Object.entries(inspectorTabs).map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
          </div>
          <div className="thread-inspector-body" key={tab + taskId}>
            {tab === "outputs" && <TaskPanel taskId={taskId} api={api} refresh={taskPanelRevision} thumbnail={panelThumbnail}
              add={(section) => { setError(""); setNotice(""); setPanelSection(section); setModal("panel-add"); }}
              open={openTaskPanel} remove={(id) => updateTaskPanel({ id, action: "remove" })} />}
            {tab === "changes" && changesPanel()}
            {tab === "usage" && usagePanel()}
            {tab === "context" && contextPanel(false)}
          </div>
        </aside>}
      </div>
      {modal && <Modal title={modelAgent ? names[modelAgent] + " model and effort" : modal === "panel-add" ? (panelSection === "outputs" ? "Add output" : "Add source") : modalTitles[modal]} close={close} wide={modal !== "target" && modal !== "codex" && modal !== "panel-add" && modal !== "panel-detail"}>
        {error && <p className="live-error" role="alert">{error}</p>}
        {notice && <p className="review-complete" role="status">{notice}</p>}
        {modal === "panel-add" && <TaskPanelEntry key={panelSection} section={panelSection} save={updateTaskPanel} busy={busy} />}
        {modal === "panel-detail" && panelDetail && <>
          <h3>{panelDetail.name}{panelDetail.agent && " · " + names[panelDetail.agent]}</h3>
          <p className="setting-detail task-panel-detail">{panelDetail.detail}</p>
        </>}
        {modal === "image" && (imagePreview
          ? <figure className="thread-image-preview"><img src={imagePreview.source} alt={imagePreview.name} /><figcaption>{imagePreview.name}</figcaption></figure>
          : !error && <p role="status">Loading image…</p>)}
        {modal === "library" && (librarySkill ? <LibrarySkillPreview skill={librarySkill} workspace={workspace}
          copy={skills.find((skill) => skill.libraryId === librarySkill.id)}
          origin={workspace?.repo === librarySkill.repo && skills.some((skill) => skill.id === librarySkill.noteId)}
          busy={locked} useSkill={() => changeLibrarySkill("use")} remove={() => changeLibrarySkill("remove")} close={close} />
          : !error && <p role="status">Loading skill…</p>)}
        {modal === "scope" && !error && <RunScope scope={runScope} files={draft.reviewFiles} />}
        {modal === "compare" && (laneComparison ? <WorktreeComparison preview={laneComparison} busy={locked} readOnly={workspace?.readOnly}
          refresh={compareWorktrees} combine={async (paths) => {
            const { taskId, main, claude } = laneComparison;
            if (await open("combine-worktrees", { taskId, paths, stamps: { main: main.stamp, claude: claude.stamp } }, "changes")) close();
          }} /> : !error && <p role="status">Comparing worktrees…</p>)}
        {modal === "queue" && queueSetup && <>
          <p className="dialog-intro">Check these changes before sending the next message. The team brief stays with the queued message.</p>
          {!queueSetup.changes.length && <p className="setting-detail">The current setup matches the queued setup.</p>}
          <SetupChanges changes={queueSetup.changes} />
          <div className="dialog-actions"><button className="button small" onClick={close}>Keep queued</button>
            {error && <button className="button small" disabled={locked} onClick={() => reviewQueue(true)}>Refresh setup</button>}
            <button className="button primary small" disabled={locked} onClick={async () => {
              if (await perform("run-next", { id: queueSetup.id, stamp: queueSetup.stamp })) close();
            }}>Use current setup &amp; run</button></div>
        </>}
        {modal === "base" && baseUpdate && <>
          <p className="dialog-intro">Prepare a new task at <strong>{baseUpdate.branch || "HEAD"} · {baseUpdate.commit.slice(0, 12)}</strong> and replay this worktree’s tracked changes and new non-ignored files.</p>
          <p className="setting-detail">AI Deck opens the copy after checking for conflicts. Changes arrive unstaged. The source task keeps its worktree, staging and conversation.</p>
          <div className="dialog-actions">
            <button className="button small" disabled={busy} onClick={close}>Keep current base</button>
            <button className="button primary small" disabled={locked} onClick={async () => {
              if (await open("update-worktree-base", baseUpdate, "changes")) {
                close();
                setNotice("Updated copy prepared. Open the source task from Projects to return to it.");
              }
            }}>{busy ? "Checking changes…" : "Check & create copy"}</button>
          </div>
        </>}
        {modal === "teamwork" && <TeamPlan mode={draft.mode} lowMemory={lowMemory} value={draft.teamwork} once={draft.assignmentOnce}
          session={workspace?.teamAssignment?.mode ? workspace.teamAssignment : undefined} sessionTitle={workspace?.title} readOnly={workspace?.readOnly} brand={(agent) => <Brand agent={agent} size={19} />}
          projectDefault={workspace?.teamwork} projectMode={workspace?.teamMode}
          running={working ? runs.at(-1) : null} queued={workspace?.queue.length ?? 0} presets={state.rolePresets ?? []}
          editPreset={(payload) => perform("edit-role-preset", payload)}
          canSave={Boolean(workspace)} canSaveProject={Boolean(workspace) && !locked} busy={busy} close={close}
          apply={(mode, teamwork) => applyTeamDraft(mode, teamwork, true)} saveSession={saveTeamSession} resetSession={() => saveTeamSession(undefined, undefined, true)}
          saveDefault={async (mode, teamwork) => {
            if (await action({ action: "team-default", teamwork, mode })) {
              if (workspace.teamAssignment?.mode) close();
              else applyTeamDraft(mode, undefined);
              setNotice("Project team brief saved.");
            }
          }} />}
        {modal === "skills" && <SkillPicker skills={skills} selected={draftSkills} toggle={toggleSkill}
          close={close} openLibrary={() => { close(); openPlugins("skills"); }} />}
        {modal === "target" && <ReviewTarget value={draft.reviewTarget} apply={(target) => {
          setDraft((current) => ({ ...current, reviewTarget: target, reviewFiles: target?.type === "commit" ? undefined : current.reviewFiles }));
          close();
        }} />}
        {modal === "files" && !error && <ReviewFiles result={reviewFiles} value={draft.reviewFiles} apply={(files) => {
          setDraft((current) => ({ ...current, reviewFiles: files }));
          close();
        }} />}
        {modal === "continue" && (!continuationPreview
          ? !error && <p role="status">Reading the current worktree…</p>
          : <>
            <p className="dialog-intro">{continuationPreview.kind === "apply-plan"
              ? "Claude will resume this plan session with edit permissions."
              : names[continuationPreview.agent] + " will inspect the current changes and continue the original implementation."}</p>
            <AssignmentEvidence mode={continuationPreview.mode} teamwork={continuationPreview.teamwork}
              label={continuationPreview.kind === "usage-handoff" ? "Transferred writer responsibilities" : "Saved handoff roles"} />
            {continuationPreview.kind !== "usage-handoff" && <pre className="file-preview deck-continuation">
              {continuationPreview.plan || "Open the timeline to read the plan."}
            </pre>}
            {!routeMode(continuationPreview.mode, state.connections, quotaClock).available.length &&
              <p className="usage-hold">{names[continuationPreview.agent]} must be signed in and have usage available to continue.</p>}
            <h3>Current Git status {continuationPreview.git.head && <code>{continuationPreview.git.head.slice(0, 12)}</code>}</h3>
            <pre className="file-preview deck-continuation">{(continuationPreview.git.status ?? "Git status unavailable") || "Working tree clean"}</pre>
            {continuationPreview.changes.length > 0 && <>
              <h3>Changes since planning</h3>
              <SetupChanges changes={continuationPreview.changes} />
              <label className="setting-row"><input type="checkbox" checked={acceptContinuationChanges}
                onChange={(event) => setAcceptContinuationChanges(event.target.checked)} /><span>Use the current worktree and settings</span></label>
            </>}
            <div className="dialog-actions">
              <button className="button small" onClick={close}>Cancel</button>
              {error && <button className="button small" disabled={locked} onClick={() => previewContinuation(continuationPreview)}>Refresh handoff</button>}
              <button className="button primary small" disabled={locked || (continuationPreview.changes.length > 0 && !acceptContinuationChanges) ||
                !routeMode(continuationPreview.mode, state.connections, quotaClock).available.length}
                onClick={async () => {
                  const { runId, stamp } = continuationPreview;
                  if (await perform("continue-run", { runId, stamp, acceptChanges: acceptContinuationChanges })) close();
                }}>
                {continuationPreview.kind === "usage-handoff" ? "Continue with " + names[continuationPreview.agent] : "Approve & apply with " + names[continuationPreview.agent]}
              </button>
            </div>
          </>)}
        {modelAgent && modelSettings(modelAgent, true)}
        {modal === "history" && <History runs={runs} initialRun={historyRun} busy={locked} reviewPlan={previewContinuation} clarifyPlan={clarifyPlan}
          decidePlan={(runId, action) => perform("team-plan-decision", { taskId, runId, action })}
          planContinuation={(id) => continuationFor(workspace, id)}
          usePrompt={(run) => {
            setDraft({ prompt: run.prompt, mode: run.mode, reviewOf: null, assignmentOnce: true, images: run.images, teamwork: run.teamwork ?? {},
              skillIds: run.skillIds?.filter((id) => skills.some((skill) => skill.id === id)) });
            close();
          }}
          draftHandoff={(run, agent) => {
            const prompt = "Continue the original task using the previous agent’s findings. Verify its claims against the current worktree.\n\n" +
              "Original task:\n" + run.prompt.slice(0, 7500) + "\n\n" + names[agent] + " handoff:\n" + agentOutput(run.agents[agent]);
            close();
            fillDraft({ ...writerHandoffDraft(run, agent), prompt });
          }} />}
        {modal === "codex" && <CodexSession busy={locked} action={(payload) => perform("codex-task-action", payload)}
          fork={async () => { if (await open("codex-task-action", { action: "fork" })) close(); }} />}
      </Modal>}
    </main>
  );
}

function cleanError(reason) {
  return reason.message.replace(/^Error invoking remote method '[^']+': Error: /u, "");
}
