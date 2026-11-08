import { useEffect, useState } from "react";
import { IconFileText, IconPhoto, IconPlus, IconRoute, IconTerminal2, IconWorld, IconX } from "@tabler/icons-react";
import { agentNames } from "./TeamThread.jsx";

const empty = { outputs: [], sources: [], processes: [] };

function TaskPanelRow({ item, thumbnail, open, remove }) {
  const [source, setSource] = useState(null);
  useEffect(() => {
    if (item.kind !== "image") return;
    let disposed = false;
    void thumbnail(item.id).then((value) => { if (!disposed) setSource(value); });
    return () => { disposed = true; };
  }, [item.id, item.kind, thumbnail]);
  const Icon = ({ link: IconWorld, image: IconPhoto, search: IconWorld, file: IconFileText })[item.kind];
  const body = <>{source ? <img src={source} alt="" /> : <Icon size={17} aria-hidden="true" />}<span>{item.name}</span></>;
  const title = [item.name, item.agent && agentNames[item.agent], item.detail].filter(Boolean).join(" · ");
  return <li className="task-panel-row">
    <button className="task-panel-item" type="button" title={title} onClick={() => open(item)}>{body}</button>
    {item.manual && <button className="icon-button task-panel-remove" type="button" title="Remove from panel"
      aria-label={"Remove " + item.name} onClick={() => remove(item.id)}><IconX size={14} /></button>}
  </li>;
}

export function TaskPanel({ taskId, api, refresh, add, open, remove, thumbnail }) {
  const [state, setState] = useState(empty);
  const [expanded, setExpanded] = useState({ outputs: false, sources: false });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!taskId) return;
    let disposed = false;
    let reading = false;
    let queued = false;
    let scan = false;
    async function read() {
      reading = true;
      while (queued && !disposed) {
        queued = false;
        const scanImages = scan;
        scan = false;
        try {
          const next = await api["task-panel"]({ taskId, scanImages });
          if (disposed || next.taskId !== taskId) continue;
          setState((current) => ({ ...next, outputs: scanImages ? next.outputs : [
            ...next.outputs, ...current.outputs.filter((entry) => entry.id.startsWith("worktree:")),
          ] }));
          setError("");
        } catch {
          if (!disposed) setError("Task details could not be refreshed.");
        }
      }
      reading = false;
    }
    function request(scanImages) {
      queued = true;
      scan ||= scanImages;
      if (!reading) void read();
    }
    const unsubscribe = api.onEvent((event) => {
      if (event.type === "task-panel-updated" && event.taskId === taskId) request(false);
      if (["finished", "run-start"].includes(event.type) && event.workspace?.taskId === taskId) request(event.type === "finished");
    });
    request(true);
    return () => { disposed = true; unsubscribe(); };
  }, [api, taskId, refresh]);

  const renderItems = (section, emptyText) => {
    const all = state[section];
    const limit = section === "sources" ? 3 : 4;
    const visible = expanded[section] ? all : all.slice(0, limit);
    return <>
      {!all.length && <p className="task-panel-empty">{emptyText}</p>}
      <ul>{visible.map((item) => <TaskPanelRow key={item.id} item={item} thumbnail={thumbnail} open={open} remove={remove} />)}</ul>
      {all.length > limit && <button className="task-panel-item task-panel-more" type="button" aria-expanded={expanded[section]}
        onClick={() => setExpanded((current) => ({ ...current, [section]: !current[section] }))}>
        <IconRoute size={17} aria-hidden="true" /><span>{expanded[section] ? "Show fewer" : "View all"}</span>
      </button>}
    </>;
  };

  return <section className="task-panel-card" aria-label="Task outputs and sources">
    {error && <p className="task-panel-empty" role="status">{error}</p>}
    <section aria-label="Outputs">
      <div className="task-panel-heading"><h3>Outputs</h3>
        <button className="icon-button" type="button" aria-label="Add output" title="Add output" disabled={!taskId}
          onClick={() => add("outputs")}><IconPlus size={18} /></button>
      </div>
      {renderItems("outputs", taskId ? "No outputs yet" : "Open a project to see task outputs")}
    </section>
    <section aria-label="Background processes">
      <div className="task-panel-heading"><h3>Background processes</h3></div>
      {!state.processes.length && <p className="task-panel-empty">No active processes</p>}
      <ul>{state.processes.map((item) => <li className="task-panel-row" key={item.id}>
        <div className="task-panel-item" title={agentNames[item.agent] + " · " + item.detail + " · " + item.label}>
          <IconTerminal2 size={17} aria-hidden="true" /><span>{item.label}</span>
        </div>
      </li>)}</ul>
    </section>
    <section aria-label="Sources">
      <div className="task-panel-heading"><h3>Sources</h3>
        <button className="icon-button" type="button" aria-label="Add source" title="Add source" disabled={!taskId}
          onClick={() => add("sources")}><IconPlus size={18} /></button>
      </div>
      {renderItems("sources", "No sources yet")}
    </section>
  </section>;
}

export function TaskPanelEntry({ save, busy, section }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  return <form onSubmit={(event) => { event.preventDefault(); void save({ action: "link", section, url, name }); }}>
    <p className="dialog-intro">Save a link or reference a file for this task.</p>
    <label className="field"><strong>URL</strong><input value={url} required type="url" maxLength={2000}
      placeholder="http://127.0.0.1:4173" onChange={(event) => setUrl(event.target.value)} /></label>
    <label className="field"><strong>Label (optional)</strong><input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label>
    <div className="dialog-actions">
      <button className="button small" type="button" disabled={busy} onClick={() => save({ action: "file", section })}>Choose file…</button>
      <button className="button primary small" disabled={busy}>Add link</button>
    </div>
  </form>;
}
