import { shareableDiffPath } from './review-snapshot.cjs';

export function sessionReviewWriter(members, reviewer, topology) {
  return sessionReviewWriters(members, reviewer, topology)[0];
}

function sessionReviewWriters(members, reviewer, topology) {
  const nativeWriter = member => member?.position === 'write' && ['codex', 'claude'].includes(member.provider);
  const index = members.findIndex(member => member.id === reviewer.id);
  if (index < 0) return [];
  if (topology !== 'tree') return members.slice(0, index).filter(nativeWriter).reverse();
  const byId = new Map(members.map(member => [member.id, member]));
  let parent = byId.get(reviewer.parentId);
  const visited = new Set([reviewer.id]), writers = [];
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    if (nativeWriter(parent)) writers.push(parent);
    parent = byId.get(parent.parentId);
  }
  return writers;
}

const findingFile = finding => typeof finding?.scope === 'string' ? finding.scope.replace(/:\d+(?::\d+)?$/u, '') : '';
export function sessionRepairOwner({ members, reviewer, topology, writes = {}, findings }) {
  const result = sessionRepairOwners({ members, reviewer, topology, writes, findings });
  if (result.groups?.length === 1) return { writer: result.groups[0].writer };
  return { reason: result.reason ?? 'The findings need more than one writer or a clearer file scope; keep them for a new plan.' };
}

export function sessionRepairOwners({ members, reviewer, topology, writes = {}, findings }) {
  const candidates = sessionReviewWriters(members, reviewer, topology);
  const actionable = (findings ?? []).filter(f => ['major', 'blocker'].includes(f?.severity));
  const owners = new Map();
  for (const finding of actionable) {
    const file = findingFile(finding);
    const matched = candidates.filter(member => writes[member.id]?.paths?.includes(file));
    if (!file || !shareableDiffPath(file) || matched.length !== 1) return { reason: 'The finding has no unique recorded owner in this reviewer’s upstream writers.' };
    const owner = matched[0];
    if (!owners.has(owner.id)) owners.set(owner.id, { writer: owner, findings: [], paths: [] });
    owners.get(owner.id).findings.push(finding);
    if (!owners.get(owner.id).paths.includes(file)) owners.get(owner.id).paths.push(file);
  }
  if (!owners.size) return { reason: 'The review has no scoped actionable findings.' };
  return { groups: members.filter(member => owners.has(member.id)).map(member => owners.get(member.id)) };
}

export function sessionWriterFilesCurrent(written, observation) {
  if (!written?.paths?.length || !written.after?.fileDigests || !observation?.fileDigests ||
      written.after.head !== observation.head || written.after.branch !== observation.branch || written.after.staged !== observation.staged) return false;
  const saved = new Map(written.after.fileDigests), current = new Map(observation.fileDigests);
  return written.paths.every(file => saved.has(file) === current.has(file) && saved.get(file) === current.get(file));
}

export function sessionUpstreamMembers(members, member, topology) {
  const index = members.findIndex(entry => entry.id === member.id);
  if (topology !== 'tree') return members.slice(0, Math.max(0, index));
  const byId = new Map(members.map(entry => [entry.id, entry])), upstream = [], seen = new Set([member.id]);
  for (let parent = byId.get(member.parentId); parent && !seen.has(parent.id); parent = byId.get(parent.parentId)) {
    seen.add(parent.id); upstream.push(parent);
  }
  return upstream;
}

export function sessionReviewHandoff(review) {
  const findings = (review.findings ?? []).filter(finding => ['major', 'blocker'].includes(finding.severity));
  return { verdict: review.verdict, current: review.current === true, partial: review.partial !== false, failedChecks: Boolean(review.failedChecks),
    findings: findings.slice(0, 12).map(({ severity, scope, detail }) => ({ severity, scope: scope.slice(0, 240), detail: detail.slice(0, 360) })),
    omitted: Math.max(0, findings.length - 12) };
}

export function sessionHandoffIssue({ member, members, topology, reports, reviews = {} }) {
  const upstream = sessionUpstreamMembers(members, member, topology);
  for (const entry of upstream) {
    const report = reports.get(entry.id);
    if (!report) return entry.name + ' did not finish a report.';
    if (report.planState && report.planState !== 'ready') return entry.name + ' has an unresolved plan (' + report.planState + ').';
    const review = reviews[entry.id];
    if (review && (review.hasChanges || review.structured || review.verdict === 'changes') &&
        (review.status !== 'completed' || review.verdict !== 'pass' || !review.current || review.partial || review.failedChecks)) {
      return entry.name + ' has unresolved or unverified review findings.';
    }
  }
}

export function sessionRepairDecision({ verdict, findings, paths, used = 0, maxRounds = 3, requiredTurns = 2, turnsLeft, current, partial, stopped, available = true }) {
  if (verdict !== 'changes') return { repair: false };
  const hold = reason => ({ repair: false, needsReview: true, reason });
  if (stopped || !available) return hold('The repair is paused because a member is unavailable or the run stopped.');
  if (used >= maxRounds || turnsLeft < requiredTurns) return hold('The bounded repair budget is exhausted; the findings remain available in this chat.');
  if (!current || partial || !paths?.length || paths.some(file => !shareableDiffPath(file))) {
    return hold('The writer scope or current review snapshot could not be verified.');
  }
  const actionable = (findings ?? []).filter(finding => ['major', 'blocker'].includes(finding?.severity));
  if (!actionable.length || actionable.some(finding => !paths.includes(findingFile(finding)))) {
    return hold('The requested changes need a scoped finding within this writer’s recorded files.');
  }
  return { repair: true, paths: [...paths], findings: actionable };
}

export function sessionRepairPrompt(cycle) {
  return 'One bounded repair of the current task. Fix only the reviewer findings in these recorded writer paths: ' +
    JSON.stringify(cycle.paths) + '. Preserve all other edits, the Git base, staging and permissions. Do not commit or push. ' +
    'Verify the repair with relevant tests and report the actual command results. Do not repeat unrelated work.\n' +
    cycle.findings.map(finding => finding.severity + ' | ' + finding.scope + ' | ' + finding.detail).join('\n');
}
