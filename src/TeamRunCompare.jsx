import { useState } from "react";

const number = new Intl.NumberFormat();
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const duration = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const count = (value) => Number.isFinite(value) ? number.format(value) : "—";
const seconds = (value) => Number.isFinite(value) ? duration.format(value / 1000) + " s" : "—";
const providers = { codex: "Codex", claude: "Claude Code", checks: "AI Deck" };

function CompareRun({ run }) {
  const { metrics, criteria, stages } = run;
  return <section className="usage-card">
    <h3>{run.title}</h3>
    <p className="setting-detail">{date.format(new Date(run.startedAt))}{run.policy && " · " + run.policy}</p>
    <dl className="team-compare-metrics">
      <dt>AI Deck turns</dt><dd>{count(metrics.turns)}</dd>
      <dt>Reported tokens</dt><dd>{count(metrics.total)}{metrics.partial && " · Partial"}</dd>
      <dt>Uncached input</dt><dd>{count(metrics.uncached)}</dd>
      <dt>Cached input</dt><dd>{count(metrics.cached)}</dd>
      <dt>Output</dt><dd>{count(metrics.output)}</dd>
      <dt>Elapsed time</dt><dd>{seconds(metrics.wallMs)}</dd>
    </dl>
    {criteria.length > 0 && <details open>
      <summary>Review criteria</summary>
      <ul>{criteria.map(({ id, text, status }) => <li key={id}><strong>{id} · {status ?? "No result"}</strong><div>{text}</div></li>)}</ul>
    </details>}
    {stages.length > 0 && <details>
      <summary>Stage timing and usage</summary>
      <ul>{stages.map((stage, index) => <li key={index}>
        {providers[stage.agent] ?? stage.agent} · {stage.kind} · {seconds(stage.durationMs)}
        {Number.isFinite(stage.turns) && " · " + count(stage.turns) + " turns"}
        {Number.isFinite(stage.tokens?.total) && " · " + count(stage.tokens.total) + " tokens"}
      </li>)}</ul>
    </details>}
  </section>;
}

export function TeamRunCompare({ runs }) {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  if (runs.length < 2) return <p className="dialog-intro">Finish two team runs in this project to compare them.</p>;
  const after = runs.find(({ id }) => id === right) ?? runs[0];
  const candidates = runs.filter(({ id }) => id !== after.id);
  const before = candidates.find(({ id }) => id === left) ?? candidates.find(({ promptKey }) => promptKey === after.promptKey) ?? candidates[0];
  const select = (label, selected, items, choose) => <label>{label}
    <select value={selected.id} onChange={(event) => choose(event.target.value)}>
      {items.map((run) => <option key={run.id} value={run.id}>{run.title} · {date.format(new Date(run.startedAt))} · {run.prompt}</option>)}
    </select>
  </label>;
  return <section className="usage-section" aria-label="Compare team runs">
    <p className="dialog-intro">{before.promptKey === after.promptKey ? "Same prompt." : "These runs used different prompts."} Results reflect the saved reports from each run.</p>
    <div className="team-compare-grid">
      <div>{select("Baseline", before, candidates, setLeft)}<CompareRun run={before} /></div>
      <div>{select("Comparison", after, runs, setRight)}<CompareRun run={after} /></div>
    </div>
  </section>;
}
