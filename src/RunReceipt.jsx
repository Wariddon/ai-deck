import { useRef } from "react";
import { receiptUsage, teamAgentName } from "../desktop/team-result.mjs";
import { ControlPopover } from "./ControlPopover.jsx";
import { ModelMeta } from "./AgentIdentity.jsx";

const number = new Intl.NumberFormat();
const duration = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const seconds = (value) => duration.format(value / 1000) + "s";

function RecordedChecks({ checks }) {
  if (!checks?.length) return null;
  return <ul>{checks.map((check, index) => <li key={index}>
    {check.command} · {check.status} · {check.freshness}{check.priorRun && " · Earlier turn"}
    {check.output && <pre>{check.output}</pre>}
  </li>)}</ul>;
}

export function RunReceipt({ run, agent, profile, reply, replyRef, followup, summary = false }) {
  const selected = useRef("");
  if (!run || !agent) return <ModelMeta profile={profile} />;
  const record = run.agents[agent];
  const final = run.collaboration?.finalReply;
  const usage = receiptUsage(run, agent, summary);
  const tokens = usage?.runTokens;
  const stages = (run.stages ?? []).filter((stage) => stage.agent === agent && (summary ? stage.kind === "summary" : stage.kind !== "summary"));
  const received = summary ? [] : (run.collaboration?.handoffs ?? []).filter((card) => card.to === agent && card.sent);
  const attached = !summary && run.followupEvidence?.sent && run.followupEvidence;
  const fromStart = (stage) => Math.max(0, Date.parse(stage.startedAt) - Date.parse(run.startedAt));
  function capture() {
    const selection = window.getSelection();
    const body = replyRef?.current;
    selected.current = body && selection?.rangeCount && body.contains(selection.anchorNode) && body.contains(selection.focusNode)
      ? selection.toString().trim() : "";
  }
  return <ControlPopover className="deck-run-receipt" title={"Run details · " + teamAgentName(agent, record)}
    beforeOpen={capture} label={<ModelMeta profile={profile} />} lazy>
    <strong>{teamAgentName(agent, record)} · Run details</strong>
    <div className="deck-receipt-usage">
      <span>{Number.isInteger(usage?.providerCalls) ? number.format(usage.providerCalls) + " AI Deck turns" : "Turn count not recorded"}</span>
      <span>{Number.isFinite(tokens?.total) ? number.format(tokens.total) + " reported tokens" : "Tokens not reported"}</span>
    </div>
    {Number.isFinite(tokens?.cached) && Number.isFinite(tokens?.input) && tokens.input >= tokens.cached &&
      <span className="setting-detail">{number.format(tokens.input - tokens.cached)} uncached input · {number.format(tokens.cached)} cached input
        {Number.isFinite(tokens.output) && " · " + number.format(tokens.output) + " output"}</span>}
    {usage?.providerCalls > tokens?.reports && <span className="setting-detail">Usage was reported for only some turns.</span>}
    {usage?.includesSummary && <span className="setting-detail">Includes team summary usage.</span>}
    {stages.length ? <ul className="deck-receipt-stages">{stages.map((stage, index) => <li key={index}>
      <strong>{stage.kind}</strong> · {Number.isFinite(stage.durationMs) ? seconds(stage.durationMs) : "In progress"}
      {Number.isFinite(fromStart(stage)) && <span> · Started +{seconds(fromStart(stage))}</span>}
      {Number.isFinite(stage.firstActivityMs) && <span> · First activity {seconds(stage.firstActivityMs)}</span>}
      {Number.isFinite(stage.toolMs) && <span> · Recorded commands {seconds(stage.toolMs)}</span>}
      {Number.isFinite(stage.teammateMs) && <span> · Waited for teammate's stage {seconds(stage.teammateMs)}</span>}
    </li>)}</ul> : <span className="setting-detail">Stage timing was not recorded for this turn.</span>}
    <details><summary>User request</summary><p>{run.prompt}</p></details>
    {received.map((card, index) => <details key={index}>
      <summary>{teamAgentName(card.from, run.agents[card.from])} · {card.kind}</summary>
      <p>{card.summary}</p>
      {card.files?.length > 0 && <p>{card.files.join(", ")}</p>}
      <RecordedChecks checks={card.checks} />
    </details>)}
    {attached && <details><summary>Evidence from the selected turn</summary>
      {attached.incremental && <p>{attached.includedPaths?.length ? "Sent changes since the recorded review." : "No changed lines to resend."}</p>}
      {attached.includedPaths?.length > 0 && <p>{attached.includedPaths.join(", ")}</p>}
      <RecordedChecks checks={attached.checks} />
    </details>}
    {summary && final && <span className="setting-detail">The summary received completed agent reports and recorded checks.</span>}
    {followup && run.finishedAt && reply && <div className="deck-control-options deck-control-separator">
      <button type="button" className="button small" onClick={() => followup(run, "codex", selected.current || reply)}>Ask Codex</button>
      <button type="button" className="button small" onClick={() => followup(run, "claude", selected.current || reply)}>Ask Claude</button>
      <span className="setting-detail">Select text first to quote just that part.</span>
    </div>}
  </ControlPopover>;
}
