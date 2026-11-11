import { memo, useRef } from "react";
import { reviewPolicies } from "../desktop/team-handoff.mjs";
import { agentOutput, agentRole } from "../desktop/collaboration.mjs";
import { teamAgentName, visibleTeamAnswer } from "../desktop/team-result.mjs";
import { OnDemandDetails, WorkSteps } from "./WorkActivity.jsx";
import { AgentMark, ModelMeta } from "./AgentIdentity.jsx";
import { runModelProfile } from "../desktop/agent-settings.mjs";
import { RunReceipt } from "./RunReceipt.jsx";
import { relationNames } from "./CodeGraph.jsx";
import { ChatMarkdown } from "./ChatMarkdown.jsx";
import { sharedBriefPrompt } from "../desktop/team-review.mjs";

const agents = { codex: "Codex", claude: "Claude Code", checks: "AI Deck" };
const roles = { write: "Builder", review: "Reviewer", plan: "Planner" };
const verdicts = { pass: "Review passed", report: "Peer report reviewed", changes: "Changes requested", blocked: "Review blocked", partial: "Review evidence was partial" };
const kinds = { build: "Build handoff", repair: "Repair handoff", "peer report": "Peer report", "lane report": "Lane handoff", "discussion reply": "Discussion reply",
  "review findings": "Findings to fix", "previous turn summary": "Previous round", "evidence request": "Evidence requested", "evidence reply": "Evidence received" };
const count = new Intl.NumberFormat();

export function AutoTeamAssignments({ assignments }) {
  if (!assignments) return null;
  return <div className="deck-tool-grid live-context-list">
    {Object.entries(assignments).map(([agent, { task, paths, acceptance }]) => <section className="deck-box" key={agent}>
      <strong>{agents[agent]} · {paths.length ? "Implement" : "Review after implementation"}</strong>
      <ChatMarkdown className="setting-detail" text={task} />
      {paths.length > 0 && <pre className="file-preview">{paths.join("\n")}</pre>}
      <ul>{acceptance.map((item, index) => <li key={index}><ChatMarkdown text={item} /></li>)}</ul>
    </section>)}
  </div>;
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
    {previous.text && <ChatMarkdown text={previous.text} />}
  </details>;
}

export function TeamHandoffs({ handoffs }) {
  if (!handoffs.length) return null;
  return <div className="team-handoffs" aria-label="Team handoffs">
    {handoffs.map((card, index) => <details key={index}>
      <summary>{agents[card.from] ?? card.from} → {agents[card.to] ?? card.to} · {kinds[card.kind] ?? card.kind}
        {card.status && " · " + card.status}
        {!card.sent && " · Prepared"}</summary>
      {card.summary && <ChatMarkdown text={card.summary} />}
      {card.criterionId && <p className="setting-detail">Focused on {card.criterionId}</p>}
      {card.files.length > 0 && <p><strong>Paths</strong> {card.files.join(", ")}</p>}
      {card.peerOnly && <p className="setting-detail">No file changes. This review covers the teammate’s report.</p>}
      {card.sha256 && <p className="setting-detail">Evidence {card.sha256.slice(0, 12)}{card.partial && " · Partial"}</p>}
      {card.evidenceDelta && <p className="setting-detail">New evidence only · previous snapshot {card.previousReviewHash?.slice(0, 12)}</p>}
      {card.sha256 && (card.checks.length
        ? <ul>{card.checks.map((check, index) => <li key={index}>{check.command} · {check.status}
          {check.exitCode != null && " · exit " + check.exitCode} · {check.freshness === "matched" ? "current checkout" : "freshness " + check.freshness}
          {check.priorRun && " · Earlier turn"}</li>)}</ul>
        : <p className="setting-detail">{card.evidenceDelta ? "No new recorded checks were included." : "No recorded checks were included."}</p>)}
    </details>)}
  </div>;
}

const decisionLabels = {
  workflow: "Workflow", "auto-team": "Auto Team", "build-review": "Codex builds → Claude reviews", "claude-build-review": "Claude builds → Codex reviews",
  review: "After review", graph: "Code graph", intent: "Message intent", finish: "Finish",
  evidence: "Need evidence", repair: "Needs changes", summarize: "Lead summary", use: "Use shortlist",
  expand_callers: "Expand callers", read_tests: "Read tests", uncertain: "Uncertain", chat: "Chat",
  review_only: "Read-only review", edit: "Edit files", clarify: "Clarify", discuss: "Team discussion",
  existing_graph_rules: "Current graph rules",
};

export function DecisionShadowReceipt({ entries }) {
  if (!entries?.length) return null;
  const label = (point, value) => point === "intent" && value === "review" ? decisionLabels.review_only : decisionLabels[value] ?? value;
  return <details className="team-brief-record">
    <summary>Local Shadow decisions</summary>
    {entries.map(({ point, decision, actual, reason, durationMs }) =>
      <div key={point}>
        <strong>{decisionLabels[point]}</strong>
        <p>Suggested {label(point, decision)} · Actual {label(point, actual)}</p>
        <p className="setting-detail">{reason}{durationMs !== undefined && " · " + durationMs + " ms"}</p>
      </div>)}
  </details>;
}

export function LocalDecisionReceipt({ entries }) {
  if (!entries?.length) return null;
  return <details className="team-brief-record">
    <summary>Local decisions</summary>
    {entries.map(({ point, agent, decision, reason }, index) =>
      <p key={index}><strong>{decisionLabels[point]}{agent && " · " + (agents[agent] ?? agent)}</strong>
        {" · "}{point === "intent" && decision === "review" ? decisionLabels.review_only : decisionLabels[decision] ?? decision}
        {" · "}{reason}</p>)}
  </details>;
}

function TeamReplyDetails({ run, collaboration, answer, records }) {
  const calls = records.reduce((total, [, record]) => total + (record.providerCalls ?? 0), 0);
  const completeUsage = calls > 0 && records.every(([, record]) => (record.runTokens?.reports ?? 0) >= (record.providerCalls ?? 0));
  const tokens = records.reduce((total, [, record]) => total + (record.runTokens?.total ?? 0), 0);
  return <>
    {run.projectTools?.length > 0 && <details><summary>Git & code evidence · {run.projectTools.length} reads</summary>
      <ul>{run.projectTools.map((entry, index) => <li key={index}>
        <strong>{teamAgentName(entry.agent, run.agents[entry.agent])}</strong> · {entry.summary}
        <span className="setting-detail"> · {entry.source} · {entry.sha256.slice(0, 12)}</span>
      </li>)}</ul>
    </details>}
    {run.checkouts && <details><summary>Workspaces checked automatically</summary>
      {Object.entries(run.checkouts).map(([lane, checkout]) => <p className="setting-detail" key={lane}>
        {lane === "main" ? "Task" : "Second writer"} · {checkout.reused ? "Reused" : "Created"} · {checkout.head.slice(0, 10)}
        {checkout.conflicted ? " · Merge conflicts" : checkout.dirty ? " · Tracked changes preserved" : " · No tracked changes before the run"}
        {checkout.operation && " · " + checkout.operation + " in progress"}{checkout.partial && " · Status truncated"}
      </p>)}
    </details>}
    <p className="setting-detail">{reviewPolicies[collaboration.policy]?.label && reviewPolicies[collaboration.policy].label + " · "}
      {count.format(calls)} {calls === 1 ? "turn" : "turns"} sent by AI Deck
      {collaboration.turnLimit && " · Limit " + collaboration.turnLimit}
      {tokens > 0 && " · " + count.format(tokens) + " reported tokens"}{calls > 0 && !completeUsage && " · Usage incomplete"}</p>
    {collaboration.finalReply?.extraUsage && <p className="setting-detail">Extra summary · {collaboration.finalReply.extraUsage.providerCalls ?? 0} turn
      {collaboration.finalReply.extraUsage.runTokens?.total > 0 && " · " + count.format(collaboration.finalReply.extraUsage.runTokens.total) + " reported tokens"}</p>}
    {answer && collaboration.findings && collaboration.findings !== answer.note && <ChatMarkdown text={collaboration.findings} />}
    <TeamHandoffs handoffs={collaboration.handoffs} />
    <DecisionShadowReceipt entries={run.decisionShadow} />
    <LocalDecisionReceipt entries={run.localDecisions} />
    {records.map(([agent, record]) => <section key={agent}>
      <p className="thread-chat-author"><AgentMark provider={record.provider ?? agent} /><strong>{teamAgentName(agent, record)}</strong>
        <span>{record.position ?? roles[agentRole(run.mode, agent)]} · {record.status} · {record.providerCalls ?? 0} sent</span>
        <ModelMeta profile={runModelProfile(record)} />
      </p>
      {record.runTokens && <p className="setting-detail">{count.format(record.runTokens.input)} input
        {" · "}{count.format(record.runTokens.cached)} cached input · {count.format(record.runTokens.output)} output</p>}
      {record.providerCalls > 0 && collaboration.contextByAgent?.[agent] && <p className="setting-detail">Knowledge and skills sent · {
        collaboration.contextByAgent[agent].map(({ name }) => name).join(", ") || "None"}</p>}
      {record.providerCalls > 0 && collaboration.codeGraphEvidence?.[agent] && <details>
        <summary>Code graph evidence · {collaboration.codeGraphEvidence[agent].query.symbol}</summary>
        <p className="setting-detail">Source snapshot {collaboration.codeGraphEvidence[agent].snapshot.slice(0, 12)}
          {collaboration.codeGraphEvidence[agent].partial && " · Partial"}</p>
        <ul>{collaboration.codeGraphEvidence[agent].locations.map(({ kind, file, line }, index) =>
          <li key={index}>{relationNames[kind]} · <code>{file}:{line}</code></li>)}</ul>
      </details>}
      {!run.discussion && record.messages.map(({ key, text }) => <ChatMarkdown className="live-log" key={key} text={text} />)}
      {!run.discussion && record.answer && !record.messages.some(({ text }) => text === record.answer) && <ChatMarkdown className="live-log" text={record.answer} />}
    </section>)}
  </>;
}

export function TeamAnswerPreview({ preview }) {
  return <article className="team-result" aria-label="Team answer in progress" aria-live="off">
    <div className="team-result-heading">
      <AgentMark provider={preview.agent} />
      <strong>Team answer · {teamAgentName(preview.agent)}</strong>
      <ModelMeta profile={preview.profile} />
      <span className="source-pill">Writing…</span>
    </div>
    <div className="team-result-answer"><ChatMarkdown text={preview.text} /></div>
  </article>;
}

function TeamReviewRecord({ run }) {
  if (!run.teamReview) return null;
  const { findings = [], reviews = {} } = run.teamReview;
  const reviewers = Object.entries(run.agents).filter(([id, record]) => record.position === "review" || reviews[id] ||
    !run.sessionTeam && agentRole(run.mode, id) === "review");
  const brief = sharedBriefPrompt(run.teamwork, run.teamReview.decisions);
  if (!reviewers.length && !brief) return null;
  return <details className="team-brief-record" open={findings.length > 0 || undefined}>
    <summary>Shared review · {findings.length} {findings.length === 1 ? "finding" : "findings"}</summary>
    {reviewers.map(([id, record]) => <p className="thread-chat-author" key={id}>
      <AgentMark provider={record.provider ?? id} /><strong>{teamAgentName(id, record)}</strong>
      <span>{reviews[id]?.fresh ? "Fresh context · " : ""}{reviews[id]?.status ?? record.status}</span>
    </p>)}
    {findings.length > 0 ? <ul>{findings.map(({ id, severity, scope, detail, reviewers: sources }) =>
      <li key={id}><strong>{id} · {severity.toUpperCase()}</strong> · <code>{scope}</code>
        <ChatMarkdown text={detail} /><p className="setting-detail">Reported by {sources.map((id) => teamAgentName(id, run.agents[id])).join(", ")}</p>
      </li>)}</ul> : <p className="setting-detail">No structured findings were recorded. This does not certify that the checks passed.</p>}
    {brief && <details><summary>Brief and decisions supplied</summary><ChatMarkdown text={brief} /></details>}
  </details>;
}

export const TeamRunResult = memo(function TeamRunResult({ run, work = [], summaryAction, chat = false, followup }) {
  const replyRef = useRef(null);
  const noteRef = useRef(null);
  const collaboration = run.collaboration ?? { handoffs: [] };
  const action = summaryAction?.id === run.id ? summaryAction : null;
  const preview = action?.pending && action.preview;
  const answer = preview ? { agent: preview.agent, text: preview.text } : visibleTeamAnswer(run);
  const records = Object.entries(run.agents);
  const final = collaboration.finalReply;
  const authorId = answer?.agent;
  const authorRecord = run.agents[authorId];
  const authorName = authorId && (answer.leader ?? teamAgentName(authorId, authorRecord));
  const profile = final?.text ? final.profile : runModelProfile(authorRecord);
  const noteAgent = answer?.noteAgent;
  const noteRecord = run.agents[noteAgent];
  const noteName = noteAgent && teamAgentName(noteAgent, noteRecord);
  const statuses = records.map(([, record]) => record.status);
  const limitedProviders = records.filter(([, record]) => record.status === "limited").map(([agent, record]) => teamAgentName(agent, record));
  const outcome = (run.discussion && limitedProviders.length ? "Usage limit · " + limitedProviders.join(", ") : undefined)
    ?? verdicts[collaboration.verdict] ?? (run.followupReview ? "Reviewed in follow-up" :
    run.reviewPending ? "Review pending" : statuses.includes("limited") ? "Usage limit reached"
    : statuses.includes("interrupted") ? "Stopped" : statuses.includes("failed") ? "Needs attention"
    : run.discussion ? (records.every(([, record]) => record.status === "completed" && agentOutput(record)) ? "Discussion complete" : "Discussion incomplete")
    : run.reviewSkipped ? "Review skipped" : "Run recorded");
  const latestCheckPacket = collaboration.handoffs.findLast((card) => card.sha256);
  return <article className="team-result" aria-label="Team result">
    <div className="team-result-heading">
      {authorId && <AgentMark provider={authorRecord?.provider ?? authorId} />}
      <strong>{run.discussion ? "Team discussion" : answer?.recorded ? "Team answer · Recorded results"
        : authorName ? "Team answer · " + authorName : answer ? "Team answer" : "Team result"}</strong>
      {preview ? <ModelMeta profile={preview.profile} /> : authorId && <RunReceipt run={run} agent={authorId} profile={profile} reply={answer.text} replyRef={replyRef} followup={followup} summary={Boolean(final?.text)} />}
      {(!chat || outcome !== "Run recorded" || !answer) && <span className="source-pill">{outcome}</span>}
    </div>
    {answer && <div className="team-result-answer" aria-live={preview ? "off" : undefined}>
      {!authorId && <span className="setting-detail">From recorded replies</span>}
      <ChatMarkdown replyRef={replyRef} quote={authorName || "Team answer"} text={answer.text} />
      {answer.note && <section className="team-result-note" aria-label={noteName ? noteName + " · " + answer.noteLabel : answer.noteLabel}>
        <div className="team-result-heading">
          {noteAgent && <AgentMark provider={noteRecord?.provider ?? noteAgent} />}
          <strong>{noteName ? noteName + " · " + answer.noteLabel : answer.noteLabel}</strong>
          {noteAgent && <RunReceipt run={run} agent={noteAgent} profile={runModelProfile(noteRecord)}
            reply={answer.note} replyRef={noteRef} followup={followup} />}
        </div>
        <ChatMarkdown replyRef={noteRef} quote={noteName || answer.noteLabel} text={answer.note} />
      </section>}
    </div>}
    {!answer && collaboration.findings && <ChatMarkdown text={collaboration.findings} />}
    <TeamReviewRecord run={run} />
    {collaboration.evidenceRequest && <p className="usage-hold" role="status">{collaboration.evidenceRequest}</p>}
    {collaboration.criteria?.length > 0 && <details open={collaboration.verdict === "blocked" || undefined}>
      <summary>Review criteria</summary>
      <ul>{collaboration.criteria.map(({ id, text }) => {
        const result = collaboration.criterionResults?.find((item) => item.id === id);
        const source = collaboration.handoffs?.findLast((card) => card.sent && card.criterionId === id && card.sha256) ??
          collaboration.handoffs?.findLast((card) => card.sent && card.sha256 && !card.evidenceDelta);
        const evidence = result?.evidence ?? (source && { snapshot: source.sha256, paths: source.files, checks: [], partial: source.partial });
        const reviewer = run.reviewSnapshot?.reviewer;
        return <li key={id}><strong>{id} · {result ? { pass: "Pass", changes: "Changes requested", blocked: "Evidence missing" }[result.status] : "No reviewer result"}</strong>
          <ChatMarkdown text={text} />{result && <ChatMarkdown className="setting-detail" text={result.detail} />}
          {evidence && <details>
            <summary>View evidence for {id}</summary>
            <p className="setting-detail">Review snapshot {evidence.snapshot?.slice(0, 12)}{evidence.partial && " · Partial"}</p>
            {evidence.retained && <p className="setting-detail">Retained from the previous review of this file scope.</p>}
            {evidence.paths?.length > 0 && <p>Diff paths supplied · {evidence.paths.join(", ")}</p>}
            {evidence.checks?.length ? <ul>{evidence.checks.map((check, index) => <li key={index}>
              {check.ref && check.ref + " · "}{check.command} · {check.status} · {check.freshness}
              {check.exitCode != null && " · exit " + check.exitCode}
              {check.source && <p className="setting-detail">{check.source}</p>}
              {check.output && <pre>{check.output}</pre>}
            </li>)}</ul> : <p className="setting-detail">No recorded check was linked to this criterion.</p>}
          </details>}
          {followup && reviewer && run.reviewSnapshot?.fileDigests && !run.reviewSnapshot.partial && collaboration.reviewObservation?.stamp &&
            <button type="button" className="button small" onClick={() => followup(run, reviewer, text, id)}>Recheck {id}</button>}
        </li>;
      })}</ul>
    </details>}
    {action && <div className="thread-actions">
      {action.pending ? <><span className="setting-detail" role="status">{action.leader} is summarizing the recorded replies…</span>
        <button className="button small" type="button" onClick={action.stop}>Stop summary</button></>
        : <button className="button small" type="button" disabled={action.disabled} onClick={action.start}
          title="Uses one extra turn and the saved replies. It does not rerun the task.">Summarize with {action.leader} · 1 turn</button>}
    </div>}
    {collaboration.skillUsage?.length > 0 && <details>
      <summary>Team skills used</summary>
      <ul>{collaboration.skillUsage.map(({ agent, stage, skills }) => <li key={agent + ":" + stage}>
        <strong>{agents[agent] ?? agent} · {stage}</strong>
        <div className="setting-detail">{skills.join(" · ")}</div>
      </li>)}</ul>
    </details>}
    {collaboration.laneScope && <details open={collaboration.verdict === "blocked" || undefined}>
      <summary>Write scope verification</summary>
      {Object.entries(collaboration.laneScope).map(([agent, scope]) => <section key={agent}>
        <p><strong>{agents[agent]}</strong> · {scope.issue ?? (scope.changed.length ? "Changes match the assigned paths" : "No file changes")}</p>
        {scope.outside?.length > 0 && <p>Outside scope · {scope.outside.join(", ")}</p>}
        {scope.changed?.length > 0 && <p className="setting-detail">Changed · {scope.changed.join(", ")}</p>}
      </section>)}
    </details>}
    {collaboration.resumedFrom && <p className="setting-detail">{run.resumedRepair ? "Review resumed from saved repair diff · " + run.resumedRepair
      : run.resumedEvidence ? "Review resumed from saved test result · " + run.resumedEvidence
      : "Review resumed from saved diff · " + collaboration.resumedFrom.slice(0, 8)}</p>}
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
});
