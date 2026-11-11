import { useId, useLayoutEffect, useRef, useState } from "react";
import { IconArrowDown, IconArrowUp, IconGripVertical, IconPlus, IconRefresh, IconShieldLock, IconUsers } from "@tabler/icons-react";
import { nativeTeamProvider, promoteTeamLead, removeTreeMember, sessionTeamOrder, sessionTeamTree, teamParentChoices, teamPositions, teamProviders } from "../desktop/session-team.mjs";
import { agentOutput, effectiveTeamwork } from "../desktop/collaboration.mjs";
import { Brand } from "./TeamThread.jsx";
import { SettingSelect } from "./SettingsCenter.jsx";
import "./session-team.css";

const options = Object.entries(teamProviders);
const newMember = (provider, position, name = teamProviders[provider]) => ({
  id: "member-" + crypto.randomUUID(), provider, name, position, model: "", instructions: "",
});

export function SessionProviders({ config, locked, perform, loadModels }) {
  const [key, setKey] = useState("");
  const [counts, setCounts] = useState({});
  const connected = config?.geminiKeySaved || config?.geminiKeyFromEnvironment;
  async function refresh(provider) {
    const models = await loadModels(provider);
    if (models) setCounts((current) => ({ ...current, [provider]: models.length }));
  }
  async function verifyKey() {
    if (!locked && key.trim() && await perform("save-gemini-key", { key })) { setKey(""); await refresh("gemini"); }
  }
  return <div className="team-provider-list">
    <section className="team-provider-card">
    <header><Brand agent="gemini" size={18} /><strong>Gemini</strong>
      <span className="source-pill">{connected ? "Key configured" : "Key needed"}</span></header>
    <p className="setting-detail">Connect a Google AI Studio API key. Free tier access depends on the selected model and Google project.</p>
    <label className="field native-hook-wide"><strong>Gemini API key</strong>
      <input type="password" autoComplete="off" value={key} maxLength={512} disabled={locked}
        onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void verifyKey(); }
        }} />
    </label>
    <div className="thread-actions">
      <button className="button small" type="button" disabled={locked || !key.trim()} onClick={verifyKey}>Verify &amp; save key</button>
      <button className="button small" type="button" disabled={locked} onClick={() => perform("provider-page", "gemini-key")}>Open Google AI Studio</button>
      {config?.geminiKeySaved && <button className="button small" type="button" disabled={locked}
        onClick={async () => { if (await perform("save-gemini-key", { remove: true })) setCounts((current) => ({ ...current, gemini: undefined })); }}>Remove saved key</button>}
      {(config?.geminiKeySaved || config?.geminiKeyFromEnvironment) && <button className="button small" type="button" disabled={locked}
        onClick={() => refresh("gemini")}>Load Gemini models</button>}
    </div>
    {counts.gemini !== undefined && <p className="setting-detail" role="status">{counts.gemini} Gemini models available.</p>}
    </section>
    <section className="team-provider-card">
    <header><Brand agent="ollama" size={18} /><strong>Ollama</strong><span className="source-pill">Runs locally</span></header>
    <p className="setting-detail">Start Ollama and install a model on this PC. AI Deck loads local models from 127.0.0.1:11434.</p>
    <div className="thread-actions">
      <button className="button small" type="button" disabled={locked} onClick={() => refresh("ollama")}>Load Ollama models</button>
      <button className="button small" type="button" disabled={locked} onClick={() => perform("provider-page", "ollama-download")}>Ollama for Windows</button>
    </div>
    {counts.ollama !== undefined && <p className="setting-detail" role="status">{counts.ollama ? counts.ollama + " local models available." : "Ollama is running. Install a model to add it to the team."}</p>}
    </section>
  </div>;
}

const editorTabs = [["members", "Members"], ["map", "Team map"], ["sharing", "Data sharing"], ["providers", "Connections"]];
const shareOptions = [
  ["shareContext", "Project context", "Project instructions, enabled notes and selected skills."],
  ["shareDiff", "Tracked Git changes", "Filtered text changes for reviewers and coordinators."],
  ["shareReports", "Project handoffs and recent rounds", "Earlier rounds and reports that can quote files, instructions or attachments."],
];

function MemberFields({ member, members, index, locked, readOnly, models, loading, change, move, remove, load, config, connect }) {
  const native = nativeTeamProvider(member.provider);
  const needsKey = member.provider === "gemini" && !config?.geminiKeySaved && !config?.geminiKeyFromEnvironment;
  const values = new Map((models ?? []).map(({ value, label }) => [value, label]));
  const defaultLabel = values.get("") ?? (native ? "Use provider default" : "Choose a model");
  values.delete("");
  if (member.model && !values.has(member.model)) values.set(member.model, member.model);
  return <section className="roster-details" aria-labelledby="roster-member-title">
    <header className="roster-detail-heading">
      <div><span className="eyebrow">Step {index + 1} of {members.length}</span><h3 id="roster-member-title">{member.name || "Unnamed member"}</h3></div>
      <div className="thread-actions">
        {[-1, 1].map((offset) => {
          const up = offset === -1;
          const Icon = up ? IconArrowUp : IconArrowDown;
          return <button key={offset} className="icon-button" type="button" title={up ? "Move up" : "Move down"}
            aria-label={up ? "Move member up" : "Move member down"} disabled={locked || !members[index + offset]}
            onClick={() => move(member.id, members[index + offset].id)}><Icon size={15} /></button>;
        })}
        <button className="button small" type="button" disabled={locked} onClick={remove}>Remove</button>
      </div>
    </header>
    <div className="roster-fields">
      <label className="field"><strong>Member name</strong>
        <input maxLength={60} value={member.name} disabled={locked} onChange={(event) => change({ name: event.target.value })} />
      </label>
      <SettingSelect label="Provider" options={options} busy={locked} value={member.provider} change={(provider) => change({
        provider, model: "", ...(!nativeTeamProvider(provider) && member.position === "write" && { position: "review" }),
      })} />
      <SettingSelect label="Role" options={Object.entries(teamPositions).filter(([position]) =>
        position !== "write" || native && !readOnly || member.position === position)} busy={locked}
        value={member.position} change={(position) => change({ position })} />
      <div className="roster-model-field">
        <label className="field"><strong>Model</strong><select value={member.model} disabled={locked}
          onChange={(event) => change({ model: event.target.value })}>
          <option value="">{defaultLabel}</option>
          {[...values].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="icon-button" type="button" disabled={locked || needsKey} title={"Load " + teamProviders[member.provider] + " models"}
          aria-label={"Load " + teamProviders[member.provider] + " models"} onClick={load}><IconRefresh size={16} /></button>
      </div>
    </div>
    {loading ? <p className="setting-detail" role="status">Loading {teamProviders[member.provider]} models…</p>
      : needsKey ? <div className="roster-inline-message"><span>Connect Gemini to choose a model.</span>
      <button className="button small" type="button" onClick={connect}>Connect Gemini</button></div>
      : !models ? <p className="setting-detail">Load models to see the choices for {teamProviders[member.provider]}.</p>
        : models.length === 0 && <p className="setting-detail">No models are available. Check the provider in Connections.</p>}
    <label className="field"><strong>Responsibilities <span className="setting-detail">Optional</span></strong>
      <textarea rows={3} maxLength={1800} value={member.instructions} disabled={locked}
        placeholder="For example, check regressions and list missing tests"
        onChange={(event) => change({ instructions: event.target.value })} />
    </label>
  </section>;
}

export function SessionTeamEditor({ workspace, config, lowMemory, locked, perform, close, save }) {
  const [members, setMembers] = useState(() => workspace.sessionTeam?.members ?? [
    newMember("codex", workspace.readOnly ? "plan" : "write"), newMember("claude", "review"),
  ]);
  const [sharing, setSharing] = useState(() => Object.fromEntries(shareOptions.map(([key]) => [key, workspace.sessionTeam?.[key] === true])));
  const [brief, setBrief] = useState(() => effectiveTeamwork(undefined, workspace.teamAssignment, workspace.teamwork) ?? {});
  const [useByDefault, setUseByDefault] = useState(workspace.sessionTeam?.useByDefault ?? true);
  const [newProvider, setNewProvider] = useState("gemini");
  const [catalogs, setCatalogs] = useState({});
  const [loadingProvider, setLoadingProvider] = useState(null);
  const [topology, setTopology] = useState(workspace.sessionTeam?.topology ?? "sequence");
  const [parallelBranches, setParallelBranches] = useState(workspace.sessionTeam?.parallelBranches === true);
  const [summaryMemberId, setSummaryMemberId] = useState(workspace.sessionTeam?.summaryMemberId ?? "");
  const [panel, setPanel] = useState(topology === "tree" ? "map" : "members");
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [validation, setValidation] = useState("");
  const selected = members.find(({ id }) => id === selectedId) ?? members[0];
  const sharedCount = Object.values(sharing).filter(Boolean).length;
  const tree = topology === "tree";
  const parentChoices = tree && selected?.parentId ? teamParentChoices(members, selected.id) : [];

  function changeTopology(next) {
    if (next === topology || locked) return;
    setTopology(next);
    if (next === "tree") setMembers((current) => sessionTeamOrder({ topology: "tree", members: current }).length === current.length
      ? current : current.map((member, index) => ({ ...member, parentId: index === 0 ? null : current[0].id })));
  }

  async function loadModels(provider) {
    setLoadingProvider(provider);
    try {
      const response = nativeTeamProvider(provider)
        ? await perform("provider-models", { agent: provider, refresh: true })
        : await perform("team-provider-models", { provider, refresh: true });
      if (!response) return null;
      const models = nativeTeamProvider(provider) ? response.models : response;
      setCatalogs((current) => ({ ...current, [provider]: models }));
      return models;
    } finally { setLoadingProvider(null); }
  }

  function change(id, next) {
    setValidation("");
    setMembers((current) => current.map((member) => member.id === id ? { ...member, ...next } : member));
  }

  function move(id, target) {
    if (locked || !target || id === target) return;
    setMembers((current) => {
      const from = current.findIndex((member) => member.id === id);
      const to = current.findIndex((member) => member.id === target);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      return next;
    });
    setSelectedId(id);
  }

  function add() {
    if (locked || members.length >= 8) return;
    const name = teamProviders[newProvider];
    const used = new Set(members.map((member) => member.name.trim().toLowerCase()));
    let candidate = name;
    for (let index = 2; used.has(candidate.toLowerCase()); index++) candidate = name + " " + index;
    const added = { ...newMember(newProvider, "review", candidate), ...(tree && { parentId: selected?.id ?? null }) };
    setMembers((current) => [...current, added]);
    setSelectedId(added.id);
    setValidation("");
  }

  async function submit(event) {
    event.preventDefault();
    if (locked) return;
    const seen = new Set();
    for (const member of members) {
      const name = member.name.trim();
      const key = name.toLowerCase();
      const issue = !name ? "Enter a member name." : seen.has(key) ? "Give this member a unique name."
        : !nativeTeamProvider(member.provider) && !member.model ? "Choose a model for " + name + "."
        : workspace.readOnly && member.position === "write" ? "Choose a read-only role for " + name + "." : "";
      if (issue) {
        setSelectedId(member.id);
        setPanel("members");
        setValidation(issue);
        return;
      }
      seen.add(key);
    }
    await save({ members, topology, parallelBranches, summaryMemberId, ...sharing, brief, useByDefault });
  }

  return <form className="session-team-editor" onSubmit={submit}>
    <div className="roster-toolbar">
      <div className="roster-tabs" role="group" aria-label="Session team settings">
        {editorTabs.map(([id, title]) => <button className="button small" type="button" key={id}
          aria-pressed={panel === id} onClick={() => setPanel(id)}>{title}{id === "sharing" && sharedCount > 0 && <span className="roster-count">{sharedCount}</span>}</button>)}
      </div>
      <span className="roster-session" title={workspace.title}><IconUsers size={15} />{workspace.title}</span>
    </div>
    <div className="roster-body">
      {panel === "members" && <div className="roster-layout">
        <section className="roster-list-pane" aria-labelledby="roster-title">
          <div className="roster-list-heading"><h3 id="roster-title">{tree ? "Members" : "Run order"}</h3><span>{members.length}/8</span></div>
          <p className="setting-detail">{tree ? "Set connections in Team map. This list orders members on the same branch level." : "Members run from top to bottom. Drag to reorder."}</p>
          <ol className="roster-list">
            {members.map((member, index) => <li key={member.id} data-dragging={dragging === member.id}
              onDragOver={(event) => { if (dragging && dragging !== member.id && !locked) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={(event) => {
                if (dragging && !locked) { event.preventDefault(); move(dragging, member.id); setDragging(null); }
              }}>
              <button className="roster-pick" type="button" aria-pressed={selected?.id === member.id} onClick={() => setSelectedId(member.id)}>
                <span className="roster-step">{index + 1}</span><Brand agent={member.provider} size={17} />
                <span className="roster-pick-copy"><strong>{member.name || "Unnamed member"}</strong>
                  <span>{teamPositions[member.position]} · {member.model || (nativeTeamProvider(member.provider) ? "Default model" : "Choose model")}</span></span>
              </button>
              <span className="roster-grip" aria-hidden="true" title="Drag to reorder" draggable={!locked && members.length > 1}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", member.id); setDragging(member.id); }}
                onDragEnd={() => setDragging(null)}><IconGripVertical size={16} /></span>
            </li>)}
          </ol>
          <div className="roster-add">
            <select aria-label="New member provider" value={newProvider} disabled={locked || members.length >= 8} onChange={(event) => setNewProvider(event.target.value)}>
              {options.map(([provider, label]) => <option key={provider} value={provider}>{label}</option>)}
            </select>
            <button className="button small" type="button" disabled={locked || members.length >= 8} onClick={add}><IconPlus size={15} />Add member</button>
          </div>
        </section>
        <div className="roster-detail-stack">
        {selected ? <MemberFields member={selected} index={members.indexOf(selected)} members={members} config={config}
          locked={locked} readOnly={workspace.readOnly} models={catalogs[selected.provider]} loading={loadingProvider === selected.provider}
          connect={() => setPanel("providers")}
          change={(next) => change(selected.id, next)} load={() => loadModels(selected.provider)} move={move}
          remove={() => {
            setMembers((current) => tree ? removeTreeMember(current, selected.id) : current.filter(({ id }) => id !== selected.id));
            if (summaryMemberId === selected.id) setSummaryMemberId("");
            setSelectedId(null); setValidation("");
          }} />
          : <section className="roster-details roster-empty"><IconUsers size={24} /><strong>Add a member to start</strong>
            <p className="setting-detail">Choose a provider to set its role and model.</p></section>}
        <details className="roster-details">
          <summary>Shared brief</summary>
          <div className="deck-form-grid">
            {[["brief", "Goal and shared context"], ["outcome", "Acceptance and handoff"],
              ["constraints", "Constraints"], ["questions", "Open questions"]].map(([key, label]) =>
              <label className="field" key={key}><strong>{label}</strong><textarea aria-label={label} rows={2} maxLength={1500}
                disabled={locked} value={brief[key] ?? ""} onChange={(event) => setBrief({ ...brief, [key]: event.target.value })} /></label>)}
          </div>
          <p className="setting-detail">Saved for this session and included with matching Team Decisions.</p>
        </details>
        <p className="setting-detail">Reviewers automatically check the current brief and evidence in a fresh conversation.</p>
        </div>
      </div>}
      {panel === "map" && <section className="team-map-editor" aria-label="Team map editor">
        <div className="team-map-controls">
          <SettingSelect label="Workflow" value={topology} options={[["sequence", "Sequential"], ["tree", "Branching"]]}
            change={changeTopology} busy={locked} />
          {tree && selected && <div className="team-map-selection">
            {selected.parentId ? <SettingSelect label={"Receives from · " + (selected.name || "Unnamed member")} value={selected.parentId}
              options={parentChoices.map(({ id, name }) => [id, name || "Unnamed member"])} busy={locked}
              change={(parentId) => change(selected.id, { parentId })} />
              : <span className="source-pill">Team lead · {selected.name || "Unnamed member"}</span>}
            {selected.parentId && <button className="button small" type="button" disabled={locked}
              onClick={() => setMembers((current) => promoteTeamLead(current, selected.id))}>Make lead</button>}
            <button className="button small" type="button" onClick={() => setPanel("members")}>Edit member</button>
          </div>}
        </div>
        {tree ? <TeamMap members={members} selected={selected?.id} select={setSelectedId}
          reparent={locked ? undefined : (id, parentId) => { change(id, { parentId }); setSelectedId(id); }} />
          : <p className="setting-detail">Choose Branching to connect each member to an upstream AI. Sequential uses the order in Members.</p>}
        {tree && <>
          <p className="setting-detail">Drag from the bottom port of the sender to the top port of the receiver. Drag an existing arrow to change its sender. Data sharing applies to handoffs and the final wrap-up.</p>
          <div className="team-map-run-options">
            <label className="setting-row">
              <input type="checkbox" checked={parallelBranches} disabled={locked} onChange={(event) => setParallelBranches(event.target.checked)} />
              <span><strong>Parallel text branches</strong><span className="setting-detail">{lowMemory
                ? "Low RAM is on. This team runs one member at a time."
                : "Gemini and Ollama can run together. Codex and Claude take turns in the shared worktree."}</span></span>
            </label>
            <SettingSelect label="Final wrap-up" options={[["", "Off"], ...members.map(({ id, name }) => [id, name || "Unnamed member"])]}
              value={summaryMemberId} change={setSummaryMemberId} busy={locked} description="Summarize branch results in a separate read-only step." />
          </div>
        </>}
      </section>}
      {panel === "sharing" && <section className="roster-options" aria-label="Data sharing">
        <div className="roster-option-heading"><IconShieldLock size={19} /><div><strong>Gemini and Ollama inputs</strong>
          <p className="setting-detail">By default they receive the task and reports based only on it. Gemini receives its inputs over the internet.</p></div></div>
        {shareOptions.map(([key, title, hint]) => <label className="setting-row" key={key}>
          <input type="checkbox" checked={sharing[key]} disabled={locked}
            onChange={(event) => setSharing((current) => ({ ...current, [key]: event.target.checked }))} />
          <span><strong>{title}</strong><span className="setting-detail">{hint}</span></span>
        </label>)}
      </section>}
      {panel === "providers" && <section className="roster-options" aria-label="Provider connections">
        <SessionProviders config={config} locked={locked} perform={perform} loadModels={loadModels} />
      </section>}
    </div>
    {validation && <p className="roster-error" role="alert">{validation}</p>}
    <footer className="roster-footer">
      <label><input type="checkbox" checked={useByDefault} disabled={locked} onChange={(event) => setUseByDefault(event.target.checked)} />
        Use by default in this session</label>
      <div className="thread-actions">
        <button className="button small" type="button" onClick={close}>Cancel</button>
        <button className="button primary" type="submit" disabled={locked}>{members.length ? "Save & use team" : "Clear team"}</button>
      </div>
    </footer>
  </form>;
}

const activeWork = { plan: "Planning", write: "Editing", review: "Reviewing", summarize: "Summarizing" };
const stageStatus = { queued: "Waiting", preparing: "Preparing", completed: "Done", failed: "Failed", interrupted: "Stopped",
  skipped: "Skipped", limited: "Usage limit" };

function TeamMapNode({ node, selected, select, run, statuses, drag, port }) {
  const { member, children } = node;
  const record = run?.agents[member.id];
  const status = record && (statuses?.[member.id] ?? record.status);
  const caption = status === "running" ? activeWork[member.position] : stageStatus[status] ?? status;
  const content = <>
    <span className="team-map-identity"><Brand agent={member.provider} size={17} /><strong title={member.name}>{member.name || "Unnamed member"}</strong></span>
    <span className="team-map-meta">{teamPositions[member.position]} · {teamProviders[member.provider]}</span>
    <span className="team-map-meta" title={record?.reportedModel || member.model}>{record?.reportedModel || member.model || "Default model"}</span>
    {caption && <span className="team-map-status" role="status">{caption}</span>}
  </>;
  return <li>
    <div className="team-map-card" data-map-member={member.id}>
    {port && member.parentId && port(member, "in")}
    {select ? <button className="team-map-node" type="button" aria-pressed={selected === member.id} onClick={() => select(member.id)}
      draggable={Boolean(drag && member.parentId)} data-drop-target={drag?.targets.has(member.id)}
      onDragStart={(event) => {
        if (!drag || !member.parentId) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", member.id);
        drag.start(member.id);
      }}
      onDragEnd={drag?.end}
      onDragOver={(event) => {
        if (drag?.targets.has(member.id)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
      }}
      onDrop={(event) => {
        if (drag?.targets.has(member.id)) { event.preventDefault(); drag.drop(member.id); }
      }}>{content}</button>
      : <div className="team-map-node" data-status={status}>{content}</div>}
    {port && port(member, "out")}
    </div>
    {children.length > 0 && <ul>{children.map((child) => <TeamMapNode key={child.member.id} node={child} selected={selected} select={select}
      run={run} statuses={statuses} drag={drag} port={port} />)}</ul>}
  </li>;
}

function connectionPath(from, to) {
  const middle = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${middle}, ${to.x} ${middle}, ${to.x} ${to.y}`;
}

function TeamMapCanvas({ root, members, selected, select, run, statuses, reparent }) {
  const canvas = useRef(null);
  const gesture = useRef(null);
  const marker = "team-arrow-" + useId().replace(/[^a-z0-9-]/gi, "");
  const [points, setPoints] = useState({});
  const [wire, setWire] = useState(null);
  const [edge, setEdge] = useState(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(null);
  const byId = new Map(members.map((member) => [member.id, member]));
  const label = (id) => byId.get(id)?.name || "Unnamed member";

  useLayoutEffect(() => {
    const element = canvas.current;
    const cards = [...element.querySelectorAll("[data-map-member]")];
    function measure() {
      const origin = element.getBoundingClientRect();
      setPoints(Object.fromEntries(cards.map((card) => {
        const box = card.getBoundingClientRect();
        const x = box.left - origin.left + box.width / 2;
        return [card.dataset.mapMember, { in: { x, y: box.top - origin.top }, out: { x, y: box.bottom - origin.top } }];
      })));
    }
    const observer = new ResizeObserver(measure);
    for (const node of [element, ...cards]) observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [members]);

  function endpoints(origin, target) {
    if (!target || origin.id === target.id || origin.side === target.side) return null;
    const child = origin.side === "in" ? origin.id : target.id;
    const parent = origin.side === "out" ? origin.id : target.id;
    return byId.get(child)?.parentId && teamParentChoices(members, child).some(({ id }) => id === parent) ? { child, parent } : null;
  }

  function connect(origin, target) {
    const link = endpoints(origin, target);
    if (!link || !reparent) {
      setNotice("Choose a sender and receiver that keep one lead and avoid a loop.");
      return false;
    }
    setWire(null);
    setEdge(link.child);
    setNotice("");
    reparent(link.child, link.parent);
    return true;
  }

  function choosePort(next) {
    if (!reparent) return;
    if (wire?.id === next.id && wire.side === next.side) {
      setWire(null);
      setNotice("");
    } else if (wire && wire.side !== next.side) {
      connect(wire, next);
    } else {
      setWire(next);
      setNotice("");
    }
  }

  function targetAt(event, origin) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!canvas.current.contains(element)) return null;
    const card = element?.closest("[data-map-member]");
    if (!card) return null;
    const target = element.closest("[data-team-port]");
    return { id: card.dataset.mapMember, side: target?.dataset.teamPort ?? (origin.side === "out" ? "in" : "out") };
  }

  function moveWire(event) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.moved ||= Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 5;
    if (!current.moved) return;
    const origin = canvas.current.getBoundingClientRect();
    const target = targetAt(event, current);
    setWire({ id: current.id, side: current.side,
      point: { x: event.clientX - origin.left, y: event.clientY - origin.top },
      target: endpoints(current, target) ? target : null });
    setNotice("");
  }

  function endWire(event) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    if (current.moved) {
      setWire(null);
      const target = targetAt(event, current);
      if (target) connect(current, target);
    } else if (current.tap) current.tap();
    else choosePort({ id: current.id, side: current.side });
  }

  function cancelWire() {
    const current = gesture.current;
    gesture.current = null;
    if (current?.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer);
    setWire(null);
    setNotice("");
  }

  function startWire(event, candidate, tap) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    gesture.current = { ...candidate, tap, pointer: event.pointerId, element, x: event.clientX, y: event.clientY };
  }

  function lostCapture(event) {
    if (gesture.current?.pointer === event.pointerId) cancelWire();
  }

  function port(member, side) {
    const id = member.id;
    const candidate = { id, side };
    const caption = (side === "in" ? "Receive at " : "Send from ") + label(id);
    return <button className="team-map-port" type="button" data-team-port={side}
      data-compatible={Boolean(wire && endpoints(wire, candidate))}
      data-hovered={wire?.target?.id === id && wire.target.side === side}
      aria-pressed={wire?.id === id && wire.side === side} aria-label={caption} title={caption}
      onPointerDown={(event) => startWire(event, candidate)}
      onLostPointerCapture={lostCapture}
      onClick={(event) => { if (!event.detail) choosePort(candidate); }} />;
  }

  function chooseEdge(member) {
    cancelWire();
    setEdge(member.id);
    select(member.id);
  }

  const drag = reparent && {
    start: setDragging, end: () => setDragging(null),
    targets: new Set(dragging ? teamParentChoices(members, dragging).map(({ id }) => id) : []),
    drop: (parentId) => {
      connect({ id: dragging, side: "in" }, { id: parentId, side: "out" });
      setDragging(null);
    },
  };
  const selectedEdge = reparent && selected === edge && byId.get(edge);
  const fixedPoint = wire && points[wire.id]?.[wire.side];
  const freePoint = wire && (wire.target ? points[wire.target.id]?.[wire.target.side] : wire.point);
  return <>
    {reparent && <p className="team-map-feedback setting-detail" role="status">{notice ||
      (wire ? wire.side === "out" ? "Choose a receiving port for " + label(wire.id) + "." : "Choose a sending port for " + label(wire.id) + "."
        : selectedEdge?.parentId ? label(selectedEdge.parentId) + " → " + label(selectedEdge.id) + " · Drag this arrow to a different sender."
          : "Drag or click the ports to connect members.")}</p>}
    <div className="team-map-scroll" tabIndex={0} aria-label="Team branches" onKeyDown={(event) => {
      if (event.key === "Escape" && (wire || gesture.current)) {
        event.preventDefault();
        event.stopPropagation();
        cancelWire();
      }
    }}>
      <div className="team-map-canvas" ref={canvas} onPointerMove={moveWire} onPointerUp={endWire} onPointerCancel={cancelWire}>
        <svg className="team-map-wires" aria-hidden={reparent ? undefined : true}>
          <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 Z" fill="context-stroke" />
          </marker></defs>
          {members.map((member) => {
            const from = points[member.parentId]?.out;
            const to = points[member.id]?.in;
            if (!from || !to) return null;
            const path = connectionPath(from, { ...to, y: to.y - (reparent ? 6 : 1) });
            const caption = label(member.parentId) + " → " + label(member.id);
            return <g className="team-map-edge" data-selected={selectedEdge?.id === member.id}
              data-rewiring={Boolean(wire?.point && wire.side === "in" && wire.id === member.id)} key={member.id}>
              <path className="team-map-wire" d={path} markerEnd={`url(#${marker})`} />
              {reparent && <path className="team-map-wire-target" d={path} role="button" tabIndex={0} aria-label={caption}
                aria-pressed={selectedEdge?.id === member.id}
                onPointerDown={(event) => startWire(event, { id: member.id, side: "in" }, () => chooseEdge(member))}
                onLostPointerCapture={lostCapture} onClick={(event) => { if (!event.detail) chooseEdge(member); }} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseEdge(member); }
                }}><title>{caption}</title></path>}
            </g>;
          })}
          {fixedPoint && freePoint && <path className="team-map-wire team-map-wire-preview"
            d={wire.side === "out" ? connectionPath(fixedPoint, freePoint) : connectionPath(freePoint, fixedPoint)} markerEnd={`url(#${marker})`} />}
        </svg>
        <ul className="team-map-tree"><TeamMapNode node={root} selected={selected} select={select && ((id) => {
          setEdge(null); cancelWire(); select(id);
        })} run={run} statuses={statuses} drag={drag} port={reparent && port} /></ul>
      </div>
    </div>
  </>;
}

export function TeamMap({ members, selected, select, run, statuses, reparent }) {
  const root = sessionTeamTree(members);
  if (!root) return <p className="setting-detail">Add members in the Members tab to build a team map.</p>;
  const wrapUp = run?.agents[run.wrapUpId];
  const status = wrapUp && (statuses?.[run.wrapUpId] ?? wrapUp.status);
  const summary = wrapUp && agentOutput(wrapUp);
  return <>
    <TeamMapCanvas root={root} members={members} selected={selected} select={select} run={run} statuses={statuses} reparent={reparent} />
    {wrapUp && <section className="team-map-wrap-up" aria-label="Final wrap-up">
      <div className="team-map-identity"><Brand agent={wrapUp.provider} size={17} /><strong>{wrapUp.memberName}</strong>
        <span className="source-pill" role="status">{status === "running" ? "Summarizing" : stageStatus[status] ?? status}</span></div>
      {summary && <details><summary>Read final wrap-up</summary><div className="team-map-wrap-up-report">{summary}</div></details>}
    </section>}
  </>;
}

export function SessionTeamProgress({ run, statuses, models, pending }) {
  return <section className="deck-team-progress" aria-label="Session team activity">
    {Object.entries(run.agents).map(([id, member], index) => {
      const status = statuses[id] ?? member.status;
      const active = !pending.has(id) && ["preparing", "running"].includes(status);
      const detail = pending.has(id) ? "Waiting for you" : status === "running" ? activeWork[member.position] : stageStatus[status] ?? status;
      const model = models[id] || member.reportedModel || member.settings?.model || teamProviders[member.provider];
      return <div key={id} className="deck-team-lane" data-agent={member.provider} data-active={active}>
        <span className="deck-team-indicator"><Brand agent={member.provider} size={16} /></span>
        <div className="deck-team-lane-text">
          <span className="deck-team-lane-title"><strong>{index + 1}. {member.memberName}</strong><span title={model}>{model}</span></span>
          <span className="deck-team-lane-detail" role="status">{detail}</span>
        </div>
      </div>;
    })}
  </section>;
}

export function SessionTeamScope({ scope }) {
  const tree = scope.sessionTeam.topology === "tree";
  return <div className="setting-list">
    <p className="dialog-intro">{tree ? "Each member receives its upstream report when data sharing allows. " +
      (scope.sessionTeam.parallelBranches && !scope.lowMemory ? "Ready Gemini and Ollama members can overlap." : "Members run one at a time.")
      : "Members run in this order."} Gemini receives its inputs over the internet.</p>
    {tree && <TeamMap members={scope.sessionTeam.members} />}
    {tree && scope.sessionTeam.summaryMemberId && <p className="setting-detail">Final wrap-up by {
      scope.sessionTeam.members.find(({ id }) => id === scope.sessionTeam.summaryMemberId)?.name
    }. Branch reports follow the data sharing rules.</p>}
    {scope.blocked && <p className="usage-hold">{scope.blocked}</p>}
    {sessionTeamOrder(scope.sessionTeam).map(({ id, name, provider, position, model }) => <div className="live-note" key={id}>
      <strong>{name} · {teamPositions[position]}</strong>
      <p className="setting-detail">{teamProviders[provider]} · {model || "Provider default"}</p>
      <p className="setting-detail">{nativeTeamProvider(provider) ? position === "write" ? "Can edit the task worktree." : "Read-only role."
        : scope.sessionTeam.shareDiff && ["review", "summarize"].includes(position) ? "Receives a filtered tracked Git diff." : "Receives text inputs."}</p>
    </div>)}
    {scope.sessionTeam.members.some(({ provider }) => !nativeTeamProvider(provider)) && <p className="setting-detail">
      {scope.sessionTeam.shareReports ? "Gemini and Ollama receive project-aware handoffs and recent team rounds."
        : "Gemini and Ollama receive only reports based on the current task. Project-aware handoffs and recent rounds are excluded."}</p>}
    {scope.notes.length > 0 && <p className="setting-detail">{scope.sessionTeam.shareContext ? "Context attached to the team" : "Context attached directly to Codex and Claude"} · {scope.notes.map(({ name }) => name).join(", ")}</p>}
  </div>;
}
