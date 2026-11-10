import { reviewPolicies } from "../desktop/team-handoff.mjs";
import { agentOutput, agentRole } from "../desktop/collaboration.mjs";
import { teamAgentName, visibleTeamAnswer } from "../desktop/team-result.mjs";
import { OnDemandDetails, WorkSteps } from "./WorkActivity.jsx";
import { AgentMark, ModelMeta } from "./AgentIdentity.jsx";
import { runModelProfile } from "../desktop/agent-settings.mjs";
import { RunReceipt } from "./RunReceipt.jsx";

const agents = { codex: "Codex", claude: "Claude Code" };
const roles = { write: "Builder", review: "Reviewer", plan: "Planner" };
const verdicts = { pass: "Review passed", report: "Peer report reviewed", changes: "Changes requested", blocked: "Review blocked", partial: "Review evidence was partial" };
const kinds = { build: "Build handoff", repair: "Repair handoff", "peer report": "Peer report", "lane report": "Lane handoff", "discussion reply": "Discussion reply",
  "review findings": "Findings to fix", "previous turn summary": "Previous round", "evidence request": "Evidence requested", "evidence reply": "Evidence received" };
const count = new Intl.NumberFormat();

export function displayedTeamRun(run, runs) {
  const original = run.collaboration?.resumedFrom && runs.find(({ id }) => id === run.collaboration.resumedFrom);
  if (original?.followupReview !== run.id || !original.collaboration) return run;
  return { ...run, mode: original.mode, agents: { ...original.agents, ...run.agents },
    collaboration: { ...run.collaboration, turnLimit: undefined,
      contextByAgent: { ...original.collaboration.contextByAgent, ...run.collaboration.contextByAgent } } };
}

export function withDiscussionPeers(rows, runs) {
  const discussions = new Map(runs.filter((run) => run.discussion).map((run) => {
    const delivered = run.collaboration?.handoffs?.find((card) => card.kind === "discussion reply" && card.sent);
    const closing = run.agents[delivered?.to];
    return [run.id, { delivered, conclusion: closing?.status === "completed" && agentOutput(closing) }];
  }));
  if (!discussions.size) return rows;
  return rows.flatMap((row) => {
    const id = row.id.split(":", 1)[0];
    const discussion = discussions.get(id);
    if (!discussion) return [row];
    if (row.handoff) return [];
    if (row.kind !== "message") return [row];
    const { delivered, conclusion } = discussion;
    if (delivered?.from === row.agent) return [{ ...row, to: delivered.to }];
    if (delivered?.to === row.agent && conclusion && row.text.trim() === conclusion) return [{ ...row, discussionConclusion: true }];
    return [row];
  });
}

export function withTeamResults(rows, runs) {
  const completed = new Map(runs.filter((run) => run.finishedAt && (run.collaboration || run.sessionTeam)).map((run) => [run.id, run]));
  if (!completed.size) return rows;
  const combined = new Map([...completed.values()].filter((run) => run.collaboration?.resumedFrom)
    .map((run) => [run.id, displayedTeamRun(run, runs)]).filter(([id, run]) => run !== completed.get(id)));
  const superseded = new Set([...combined.values()].map((run) => run.collaboration.resumedFrom));
  const lastRow = new Map(rows.map((row, index) => [row.id.split(":", 1)[0], index]));
  const work = new Map();
  for (const row of rows) {
    const id = row.id.split(":", 1)[0];
    const run = completed.get(id);
    if (!run || run.discussion || row.kind !== "activity" || row.handoff && !run.sessionTeam) continue;
    if (!work.has(id)) work.set(id, []);
    work.get(id).push(row);
  }
  return rows.flatMap((row, index) => {
    const id = row.id.split(":", 1)[0];
    const run = completed.get(id);
    if (!run) return [row];
    const visible = !run.discussion && (row.kind === "message" || row.kind === "activity") || combined.has(id) && row.kind === "prompt" ? [] : [row];
    if (!superseded.has(id) && lastRow.get(id) === index) {
      const previous = combined.has(id) ? work.get(run.collaboration.resumedFrom) ?? [] : [];
      visible.push({ id: id + ":team-result", kind: "team-result", run: combined.get(id) ?? run, work: [...previous, ...(work.get(id) ?? [])] });
    }
    return visible;
  });
}

export function TeamBriefRecord({ run }) {
  const collaboration = run?.collaboration;
  const last = collaboration?.handoffs.findLast((card) => card.sent);
  const previous = run?.finishedAt && collaboration
    ? { verdict: collaboration.verdict, files: last?.files ?? [], text: (collaboration.findings || last?.summary || "").slice(0, 700) }
    : collaboration?.prior;
  if (!previous?.text && !previous?.files.length && !previous?.verdict) return null;
  return <details className="team-brief-record">
    <summary>Previous team outcome</summary>
    {previous.verdict && <p>{verdicts[previous.verdict]}</p>}
    {previous.files.length > 0 && <p>{previous.files.join(", ")}</p>}
    {previous.text && <p>{previous.text}</p>}
  </details>;
}

export function TeamHandoffs({ handoffs }) {
  if (!handoffs.length) return null;
  return <div className="team-handoffs" aria-label="Team handoffs">
    {handoffs.map((card, index) => <details key={index}>
      <summary>{agents[card.from] ?? card.from} → {agents[card.to] ?? card.to} · {kinds[card.kind] ?? card.kind}
        {card.status && " · " + card.status}
        {!card.sent && " · Prepared"}</summary>
      {card.summary && <p>{card.summary}</p>}
      {card.files.length > 0 && <p><strong>Paths</strong> {card.files.join(", ")}</p>}
      {card.peerOnly && <p className="setting-detail">No file changes. This review covers the teammate’s report.</p>}
      {card.sha256 && <p className="setting-detail">Evidence {card.sha256.slice(0, 12)}{card.partial && " · Partial"}</p>}
      {card.sha256 && (card.checks.length
        ? <ul>{card.checks.map((check, index) => <li key={index}>{check.command} · {check.status}
          {check.exitCode != null && " · exit " + check.exitCode} · {check.freshness === "matched" ? "current checkout" : "freshness " + check.freshness}
          {check.priorRun && " · Earlier turn"}</li>)}</ul>
        : <p className="setting-detail">No recorded checks were included.</p>)}
    </details>)}
  </div>;
}

function TeamReplyDetails({ run, collaboration, answer, records }) {
  const calls = records.reduce((total, [, record]) => total + (record.providerCalls ?? 0), 0);
  const completeUsage = calls > 0 && records.every(([, record]) => (record.runTokens?.reports ?? 0) >= (record.providerCalls ?? 0));
  const tokens = records.reduce((total, [, record]) => total + (record.runTokens?.total ?? 0), 0);
  return <>
    <p className="setting-detail">{reviewPolicies[collaboration.policy]?.label && reviewPolicies[collaboration.policy].label + " · "}
      {count.format(calls)} {calls === 1 ? "turn" : "turns"} sent by AI Deck
      {collaboration.turnLimit && " · Limit " + collaboration.turnLimit}
      {tokens > 0 && " · " + count.format(tokens) + " reported tokens"}{calls > 0 && !completeUsage && " · Usage incomplete"}</p>
    {collaboration.finalReply?.extraUsage && <p className="setting-detail">Extra summary · {collaboration.finalReply.extraUsage.providerCalls ?? 0} turn
      {collaboration.finalReply.extraUsage.runTokens?.total > 0 && " · " + count.format(collaboration.finalReply.extraUsage.runTokens.total) + " reported tokens"}</p>}
    {answer && collaboration.findings && collaboration.findings !== answer.note && <p>{collaboration.findings}</p>}
    <TeamHandoffs handoffs={collaboration.handoffs} />
    {records.map(([agent, record]) => <section key={agent}>
      <p className="thread-chat-author"><AgentMark provider={record.provider ?? agent} /><strong>{teamAgentName(agent, record)}</strong>
        <span>{record.position ?? roles[agentRole(run.mode, agent)]} · {record.status} · {record.providerCalls ?? 0} sent</span>
        <ModelMeta profile={runModelProfile(record)} />
      </p>
      {record.runTokens && <p className="setting-detail">{count.format(record.runTokens.input)} input
        {" · "}{count.format(record.runTokens.cached)} cached input · {count.format(record.runTokens.output)} output</p>}
      {record.providerCalls > 0 && collaboration.contextByAgent?.[agent] && <p className="setting-detail">Knowledge and skills sent · {
        collaboration.contextByAgent[agent].map(({ name }) => name).join(", ") || "None"}</p>}
      {!run.discussion && record.messages.map(({ key, text }) => <p className="live-log" key={key}>{text}</p>)}
      {!run.discussion && record.answer && !record.messages.some(({ text }) => text === record.answer) && <p className="live-log">{record.answer}</p>}
    </section>)}
  </>;
}

export function TeamRunResult({ run, work = [], summaryAction, chat = false, followup }) {
  const replyRef = useRef(null);
  const collaboration = run.collaboration ?? { handoffs: [] };
  const answer = visibleTeamAnswer(run);
  const action = summaryAction?.id === run.id ? summaryAction : null;
  const records = Object.entries(run.agents);
  const final = collaboration.finalReply;
  const wrapUp = run.agents[run.wrapUpId] ? records.find(([id]) => id === run.wrapUpId)
    : records.findLast(([, record]) => record.position === "summarize" && record.status === "completed");
  const author = final?.text ? final.agent : answer?.leader ? wrapUp?.[1].provider ?? wrapUp?.[0] : undefined;
  const authorId = final?.text ? final.agent : wrapUp?.[0];
  const profile = final?.text ? final.profile : runModelProfile(wrapUp?.[1]);
  const statuses = records.map(([, record]) => record.status);
  const outcome = verdicts[collaboration.verdict] ?? (run.followupReview ? "Reviewed in follow-up" :
    run.reviewPending ? "Review pending" : statuses.includes("limited") ? "Usage limit reached"
    : statuses.includes("interrupted") ? "Stopped" : statuses.includes("failed") ? "Needs attention"
    : run.discussion ? (records.every(([, record]) => record.status === "completed" && agentOutput(record)) ? "Discussion complete" : "Discussion incomplete")
    : run.reviewSkipped ? "Review skipped" : "Run recorded");
  const latestCheckPacket = collaboration.handoffs.findLast((card) => card.sha256);
  return <article className="team-result" aria-label="Team result">
    <div className="team-result-heading">
      {author && <AgentMark provider={author} />}
      <strong>{run.discussion ? "Team discussion" : answer?.leader ? "Team answer · " + answer.leader : answer ? "Team answer" : "Team result"}</strong>
      {author && <RunReceipt run={run} agent={authorId} profile={profile} reply={answer?.text} replyRef={replyRef} followup={followup} summary={Boolean(final?.text)} />}
      {(!chat || outcome !== "Run recorded" || !answer) && <span className="source-pill">{outcome}</span>}
    </div>
    {answer && <div className="team-result-answer">
      {!answer.leader && <span className="setting-detail">From recorded replies</span>}
      <p ref={replyRef}>{answer.text}</p>
      {answer.note && <p><strong>{answer.noteLabel} · </strong>{answer.note}</p>}
    </div>}
    {!answer && collaboration.findings && <p>{collaboration.findings}</p>}
    {action && <div className="thread-actions">
      {action.pending ? <><span className="setting-detail" role="status">{action.leader} is summarizing the recorded replies…</span>
        <button className="button small" type="button" onClick={action.stop}>Stop summary</button></>
        : <button className="button small" type="button" disabled={action.disabled} onClick={action.start}
          title="Uses one extra turn and the saved replies. It does not rerun the task.">Summarize with {action.leader} · 1 turn</button>}
    </div>}
    {collaboration.laneScope && <details open={collaboration.verdict === "blocked" || undefined}>
      <summary>Write scope verification</summary>
      {Object.entries(collaboration.laneScope).map(([agent, scope]) => <section key={agent}>
        <p><strong>{agents[agent]}</strong> · {scope.issue ?? (scope.changed.length ? "Changes match the assigned paths" : "No file changes")}</p>
        {scope.outside?.length > 0 && <p>Outside scope · {scope.outside.join(", ")}</p>}
        {scope.changed?.length > 0 && <p className="setting-detail">Changed · {scope.changed.join(", ")}</p>}
      </section>)}
    </details>}
    {collaboration.resumedFrom && <p className="setting-detail">Review resumed from saved diff · {collaboration.resumedFrom.slice(0, 8)}</p>}
    {collaboration.pauseReason && <p className="setting-detail">{collaboration.pauseReason}</p>}
    {collaboration.smartCheck && <p className="setting-detail">{collaboration.smartCheck.check} · {collaboration.smartCheck.status} · {collaboration.smartCheck.file}</p>}
    {collaboration.requiredChecks?.length > 0 && <details>
      <summary>Configured checks</summary>
      {collaboration.requiredChecks.map((check) => <p key={check.name}>{check.name} · {check.status}{check.code != null && " · exit " + check.code}</p>)}
    </details>}
    {run.reviewSkipped && <p>{run.reviewSkipped}</p>}
    {latestCheckPacket?.checks.some((check) => check.freshness !== "matched") &&
      <p className="setting-detail">Some checks could not be matched to the reviewed files.</p>}
    {work.length > 0 && <OnDemandDetails summary={<>Work steps ({count.format(work.length)})</>}>
      <WorkSteps steps={work} agentLabel={(step) => teamAgentName(step.agent, run.agents[step.agent])} />
    </OnDemandDetails>}
    <OnDemandDetails summary="Agent replies and usage">
      <TeamReplyDetails run={run} collaboration={collaboration} answer={answer} records={records} />
    </OnDemandDetails>
  </article>;
}
import { useRef } from "react";
