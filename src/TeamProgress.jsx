import { agentRole } from "../desktop/collaboration.mjs";
import { Brand, agentNames } from "./TeamThread.jsx";
import { TeamHandoffs } from "./TeamHandoff.jsx";
import { teamAgentName } from "../desktop/team-result.mjs";
import "./team-progress.css";

export { AutoTeamAssignments } from "./TeamHandoff.jsx";

const phases = {
  propose: "Proposing the plan",
  negotiate: "Checking the plan and assigning work",
  implement: "Implementing its assignment",
  "prepare-review": "Preparing the teammate’s diff",
  review: "Reviewing the teammate’s work",
  revise: "Addressing review findings",
  recheck: "Checking the revised changes",
  "prepare-combined": "Preparing a combined checkout",
  "required-checks": "Running required checks on the final checkout",
  "approved-check": "AI Deck is running the saved check",
  "answer evidence request": "Finding evidence for the reviewer",
  "recheck evidence": "Checking the test result",
  repair: "Addressing review findings",
  integration: "Checking the combined changes",
};
const defaultPhase = { plan: "Planning", review: "Reviewing", write: "Implementing" };
const activityPhase = (activity, fallback) => typeof activity === "string" ? activity : activity?.phase ?? fallback;
const statusesText = {
  completed: "Stage finished", failed: "Failed", interrupted: "Stopped", skipped: "Skipped",
  limited: "Usage limit reached", "awaiting-approval": "Waiting for your approval",
};
export const teamResults = {
  reviewed: "Team review complete", approval: "Team plan ready for approval", limited: "Paused at usage limit",
  blocked: "Team needs your decision", "checks-failed": "Required checks need attention", interrupted: "Team run stopped", running: "Working as a team",
};

export function TeamBoard({ run, statuses, activity, working }) {
  const collaboration = run.collaboration;
  const handoffs = collaboration?.handoffs ?? [];
  const checks = run.autoTeam?.requiredChecks ?? collaboration?.requiredChecks ?? [];
  const summary = run.stages?.findLast((stage) => stage.kind === "summary");
  const hasSummary = Boolean(collaboration?.finalReply || run.agents[run.wrapUpId]?.status === "completed");
  return <>
    <p className="dialog-intro">{run.prompt}</p>
    <div className="deck-team-board">
      {Object.entries(run.agents).map(([agent, record]) => {
        const status = (working ? statuses[agent] : undefined) ?? record.status;
        const phase = phases[activityPhase(activity[agent], run.autoTeam?.activity?.[agent])];
        const assignment = run.teamPlan?.assignments?.[agent]?.task ?? run.teamwork?.[agent] ??
          (run.mode === "parallel-checks" ? agent === Object.keys(run.agents)[0] ? "Implementation and risks" : "Tests and reproduction" : undefined);
        const delivered = handoffs.filter((entry) => entry.from === agent && entry.sent);
        return <section className="deck-box" key={agent}>
          <h3><Brand agent={record.provider ?? agent} size={16} />{teamAgentName(agent, record)}</h3>
          <p>{(working && phase) || statusesText[status] || ({ queued: "Waiting", preparing: "Preparing", running: "In progress" })[status] || status}</p>
          <p className="setting-detail">{assignment ?? record.position ?? (run.discussion ? "Discussion" : agentRole(run.mode, agent))}</p>
          {delivered.length > 0 && <p className="setting-detail">{delivered.length} {delivered.length === 1 ? "handoff delivered" : "handoffs delivered"}</p>}
        </section>;
      })}
    </div>
    {Number.isFinite(collaboration?.reviewPreparationMs) && <p className="setting-detail">
      Review evidence prepared in {(collaboration.reviewPreparationMs / 1000).toFixed(1)}s
    </p>}
    {handoffs.length > 0 && <><h3>Handoffs and evidence</h3><TeamHandoffs handoffs={handoffs} /></>}
    {checks.length > 0 && <><h3>Configured checks</h3><ul>{checks.map((check) => <li key={check.name}>
      {check.name} · {check.status}{check.sharedFrom && " · Shared result from " + check.sharedFrom}
      {check.independentRepeat && " · Ran independently because result sharing was off"}
    </li>)}</ul></>}
    {(collaboration?.pauseReason || run.reviewSkipped || ["blocked", "partial", "changes"].includes(collaboration?.verdict)) &&
      <section className="deck-box"><strong>Open for review</strong>
        <p>{collaboration?.pauseReason || run.reviewSkipped || collaboration?.findings || "Check the latest review for unresolved evidence."}</p></section>}
    {summary && <p className="setting-detail">{hasSummary ? "Team summary recorded" : Number.isFinite(summary.durationMs)
      ? "Summary attempt ended" : "The lead is preparing the team summary"}</p>}
  </>;
}

export function TeamProgress({ run, statuses, activity, reportedModels, pending, working }) {
  if (!run || Object.keys(run.agents).length !== 2 && !run.resumedEvidence && !run.resumedRepair) return null;
  const discussionHandoff = run.discussion && run.collaboration?.handoffs?.findLast((card) => card.kind === "discussion reply");
  const hasActive = Object.entries(run.agents).some(([agent, record]) =>
    ["preparing", "running"].includes(statuses[agent] ?? record.status));
  return <section className="deck-team-progress" aria-label="Team activity">
    {Object.entries(run.agents).map(([agent, record]) => {
      const status = statuses[agent] ?? record.status;
      const progress = activity[agent];
      const stage = activityPhase(progress, run.autoTeam?.activity?.[agent]);
      const phase = phases[stage] ?? (stage === "discussion" && discussionHandoff?.to === agent
        ? "Responding to " + agentNames[discussionHandoff.from] : undefined);
      const summarizing = run.collaboration?.summarizing === agent;
      const active = working && !pending.has(agent) && (summarizing || stage === "approved-check" || ["preparing", "running"].includes(status));
      const handoff = run.collaboration?.handoffs?.findLast((card) => card.to === agent);
      const sendingHandoff = active && status === "running" && handoff && !handoff.sent;
      const model = reportedModels[agent] || record.reportedModel || record.settings?.model || "Default model";
      const detail = summarizing ? "Writing the team answer" : pending.has(agent) ? "Waiting for your response"
        : active && stage === "approved-check" && progress?.criterionId ? "Waiting for test result · " + progress.criterionId
        : sendingHandoff ? run.discussion ? "Receiving " + agentNames[handoff.from] + "’s reply"
          : handoff.sha256 ? "Sending review evidence" : "Sending the handoff"
        : active && status === "running" && progress?.phase && handoff?.sent && handoff.sha256 && !progress.replyStarted
          ? "Evidence received · waiting for first reply" + (progress?.criterionId ? " · " + progress.criterionId : "")
        : active ? (phase ?? (run.discussion ? "Preparing a reply" : status === "preparing" ? "Preparing workspace" : defaultPhase[agentRole(run.mode, agent)])) +
          (progress?.criterionId ? " · " + progress.criterionId : "")
        : working && status === "queued" ? hasActive ? "Waiting for teammate" : "Waiting to start"
        : run.autoTeam?.status === "approval" ? "Waiting for your approval"
        : statusesText[status] ?? "Waiting to start";
      return <div key={agent} data-agent={agent} data-active={active} className="deck-team-lane" title={phase ?? detail}>
        <span className="deck-team-indicator"><Brand agent={agent} size={16} /></span>
        <div className="deck-team-lane-text">
          <span className="deck-team-lane-title"><strong>{agentNames[agent]}</strong><span title={model}>{model}</span></span>
          <span className="deck-team-lane-detail" key={detail} role="status" title={detail}>{detail}</span>
        </div>
      </div>;
    })}
  </section>;
}

function stepLabel(id) {
  if (id === "integration") return "Combined changes";
  if (id === "integration-recheck") return "Combined changes after repair";
  const [agent, stage, round] = id.split("-");
  const who = agentNames[agent];
  if (stage === "check") return who + (round === "fix" ? " · Required check repair" : " · Repair review");
  if (stage === "review") return who + "’s work · " + (round === "1" ? "recheck" : "peer review");
  return who + (stage === "fix" ? " · Revision" : " · Implementation");
}

export function AutoTeamRecord({ record }) {
  if (!record) return null;
  return <section className="live-note">
    <strong>{teamResults[record.status] ?? "Auto Team"}</strong>
    {record.detail && <p className="setting-detail">{record.detail}</p>}
    {record.assignmentGraph && <p className="setting-detail">JS/TS dependency graph · {record.assignmentGraph.files} files · {record.assignmentGraph.groups} groups
      {record.assignmentGraph.partial && " · Partial"}</p>}
    {record.scopeViolation && <details open>
      <summary>{agentNames[record.scopeViolation.agent]} changed paths outside the approved assignment</summary>
      <pre className="file-preview deck-continuation">{record.scopeViolation.files.join("\n")}</pre>
    </details>}
    {record.requiredChecks?.length > 0 && <section className="native-hook-form" aria-label="Required check results">
      <strong>Required checks · {record.checkSnapshot?.target === "combined" ? "Combined checkout" : "Final checkout"}</strong>
      {record.checkSnapshot?.stamp && <span className="setting-detail">Snapshot {record.checkSnapshot.stamp.slice(0, 12)}</span>}
      {record.requiredChecks.map(({ name, status, code, output }) => <details key={name}>
        <summary>{name} · {status}{Number.isInteger(code) && " · exit " + code}</summary>
        {output && <pre className="file-preview deck-continuation">{output}</pre>}
      </details>)}
    </section>}
    {record.partial && <p className="setting-detail">Some review inputs were partial. Check what the reviewer could see before accepting the result.</p>}
    {record.proposal && <details><summary>{agentNames[record.planner ?? "codex"]} proposal</summary><pre className="file-preview deck-continuation">{record.proposal}</pre></details>}
    {Object.entries(record.handoffs ?? {}).map(([id, handoff]) => <details key={"handoff:" + id}>
      <summary>{agentNames[handoff.from] ?? "AI Deck checks"} → {agentNames[handoff.to]} · {handoff.kind}</summary>
      {handoff.next && <p className="setting-detail">{handoff.next}</p>}
      <pre className="file-preview deck-continuation">{[
        handoff.files?.length && "Changed paths\n" + handoff.files.join("\n"), handoff.text, handoff.checks,
      ].filter(Boolean).join("\n\n")}</pre>
    </details>)}
    {Object.entries(record.results).map(([id, result]) => <details key={id}>
      <summary>{stepLabel(id)}{result.verdict && " · " + result.verdict}</summary>
      <pre className="file-preview deck-continuation">{result.text || "No written summary returned."}</pre>
    </details>)}
    {record.reviews?.map(({ agent, sha256, checks, partial }, index) => <details key={agent + index}>
      <summary>{agentNames[agent]} · Review input {sha256.slice(0, 12)}{partial && " · Partial"}</summary>
      <pre className="file-preview deck-continuation">{checks}</pre>
    </details>)}
  </section>;
}
