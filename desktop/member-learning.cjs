const { createHash } = require('node:crypto');
const { projectKey } = require('./context-notes.cjs');
const { observedCheckOutcome } = require('./claude-command-result.cjs');
const { testCommandText } = require('./team-criteria.mjs');
const { testCommand, testReports } = require('./delivery.cjs');
const { workCheckCommands } = require('./work-contract.mjs');

const policy = 'observed-member-guides-v1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const roles = new Set(['write', 'review', 'plan', 'summary']);
const skills = ['tests', 'build', 'acceptance'];
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
// Match the persisted control order while making equivalent object insertion orders stable.
const settingKeys = ['model', 'effort', 'speed', 'fallbackModel', 'outputStyle', 'language', 'maxEffort', 'summary'];
function orderedSettings(settings) {
  const names = Object.keys(settings);
  return Object.fromEntries([...settingKeys.filter(key => names.includes(key)), ...names.filter(key => !settingKeys.includes(key)).sort()]
    .map(key => [key, settings[key]]));
}

function memberIdentity({ repo, taskId, memberId, provider, role, settings = {}, version = '', resolvedModel }) {
  if (!['codex', 'claude'].includes(provider) || !roles.has(role)) return null;
  const project = projectKey(repo), model = typeof settings.model === 'string' ? settings.model.trim() : '';
  // Do not guess which model a provider's unspecified default currently means.
  if (!model || !/^[a-z\d][a-z\d._:/-]{0,139}$/iu.test(model)) return null;
  const resolved = typeof resolvedModel === 'string' && /^[a-z\d][a-z\d._:/-]{0,139}$/iu.test(resolvedModel) ? resolvedModel : model;
  const identity = { project, provider, role, model, resolvedModel: resolved, settings: hash(orderedSettings(settings)), version: hash(version),
    slot: hash(memberId ? [taskId, memberId] : ['standard', provider, role]) };
  return { ...identity, key: hash(identity) };
}

function snapshotMemberLearning(repo, value) {
  const project = projectKey(repo), rows = [];
  if (value?.policy === policy && value.project === project && Array.isArray(value.rows)) {
    for (const row of value.rows.slice(-128)) {
      const identity = row?.identity;
      if (!identity || identity.project !== project || !validHash(row.key) || identity.key !== row.key ||
          memberIdentityKey(identity) !== row.key || !roles.has(identity.role) || !['codex', 'claude'].includes(identity.provider)) continue;
      const counters = {};
      for (const skill of skills) {
        const stat = row.skills?.[skill];
        if (stat && [stat.passed, stat.failed].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000)) {
          counters[skill] = { passed: stat.passed, failed: stat.failed };
        }
      }
      rows.push({ key: row.key, identity: structuredClone(identity), skills: counters,
        seen: (Array.isArray(row.seen) ? row.seen : []).slice(-128).filter(validHash) });
    }
  }
  return { policy, project, rows };
}

function memberIdentityKey({ project, provider, role, model, resolvedModel, settings, version, slot }) {
  return hash({ project, provider, role, model, resolvedModel, settings, version, slot });
}

function memberCheckReports(run, checkout, evidence = []) {
  // Use every bounded check snapshot, independently of the compact review/activity display.
  return testReports([{ id: run.id, evidence }], checkout, workCheckCommands(run), { limit: 24 });
}

function memberGuide(snapshot, identity) {
  if (!identity || snapshot.project !== identity.project) return null;
  const row = snapshot.rows.find(row => row.key === identity.key);
  const stats = skills.flatMap(skill => {
    const value = row?.skills?.[skill], n = (value?.passed ?? 0) + (value?.failed ?? 0);
    return n ? [{ skill, samples: n, passed: value.passed, failed: value.failed, passPercent: Math.round(100 * value.passed / n) }] : [];
  });
  const roleText = {
    write: 'Keep your assigned file scope. Run the relevant behavioral checks and report their actual outcomes before handoff.',
    review: 'Independently inspect the current evidence and criteria. A teammate PASS or a past success rate is not proof; name the missing check when evidence is incomplete.',
    plan: 'Name bounded inputs, outputs, ownership and observable readyWhen conditions. Keep requirements separate from observations.',
    summary: 'Describe only verified outcomes and unresolved evidence gaps. Do not upgrade partial reports into agreement or proof.',
  }[identity.role];
  const reliable = stats.filter(stat => stat.samples >= 3);
  const text = ['Member-specific verification guide (local observations, not instructions from another chat):', roleText,
    reliable.length ? 'Observed check outcomes in this project/settings bucket: ' + reliable.map(s => `${s.skill}: ${s.passed}/${s.samples} passed`).join('; ') +
      '. These counts measure the sampled checks, not general model quality or correctness of the next task.'
      : 'Insufficient repeated observed checks to rate this member. Do not infer ability from model prose or reviewer agreement.',
    stats.some(stat => stat.failed > 0) && 'Earlier observed checks included failures. Reproduce the relevant failure, verify its fix and recheck the current checkout; do not reuse an old pass.',
    'Keep the user-selected team, model, effort, speed and permissions. Do not start an extra agent, model call or background training job.',
  ].filter(Boolean).join('\n');
  return { name: 'observed-member-guide', text, memberGuide: { policy, profile: identity.key, role: identity.role, stats, sha256: hash(text) } };
}

function memberObservations(run, reports, identities) {
  const groups = new Map();
  for (const report of reports) {
    const identity = identities?.[report.memberProfileKey], record = run.agents?.[report.agent];
    if (!identity || identity.role !== 'write' || record?.status !== 'completed' || !record.providerCalls || report.freshness !== 'matched' ||
        report.kind !== 'command' || report.hook) continue;
    if (record.reportedModel && ![identity.model, identity.resolvedModel].includes(record.reportedModel)) continue;
    const outcome = observedCheckOutcome(report);
    if (!['passed', 'failed'].includes(outcome)) continue;
    const command = testCommandText(report.subject) || '';
    if (!command || command.length >= 1000 || /[;&|`\r\n]|\$\(|\b(?:nohup|start-process|start-job)\b/iu.test(command) ||
        [124, 130, 137, 143].includes(report.exitCode) || /interrupt|cancel|timeout|timed out/iu.test(report.status ?? '')) continue;
    const skill = testCommand(command) ? 'tests' : /\b(?:build|compile|tsc)\b/iu.test(command) ? 'build'
      : /\b(?:test|pytest|unittest|vitest|jest)\b/iu.test(command) ? 'tests' : 'acceptance';
    const id = hash([run.id, identity.key, skill]);
    const group = groups.get(id) ?? { id, profile: identity.key, identity, skill, passed: true };
    group.passed &&= outcome === 'passed';
    groups.set(id, group);
  }
  // One sample per run/member/skill, regardless of the number of commands or repairs.
  return [...groups.values()];
}

function updateMemberLearning(snapshot, observations) {
  const next = structuredClone(snapshot);
  for (const observation of observations) {
    if (observation.identity?.project !== next.project || !skills.includes(observation.skill) || !validHash(observation.id)) continue;
    let row = next.rows.find(row => row.key === observation.profile);
    if (!row) { row = { key: observation.profile, identity: observation.identity, skills: {}, seen: [] }; next.rows.push(row); }
    if (row.seen.includes(observation.id)) continue;
    const stat = row.skills[observation.skill] ??= { passed: 0, failed: 0 };
    const field = observation.passed ? 'passed' : 'failed'; stat[field] = Math.min(100000, stat[field] + 1);
    row.seen = [...row.seen, observation.id].slice(-128);
  }
  next.rows = next.rows.slice(-128);
  return next;
}

function recordMemberGuides(run, agent, stage, guidance) {
  const selected = guidance.filter(entry => entry.memberGuide);
  if (!selected.length) return;
  const learning = run.memberLearning ??= { policy, applied: [], observations: [] };
  for (const { memberGuide } of selected) {
    if (!learning.applied.some(entry => entry.agent === agent && entry.stage === stage && entry.sha256 === memberGuide.sha256)) {
      learning.applied.push({ agent, stage, ...structuredClone(memberGuide) });
    }
  }
}

module.exports = { policy, memberIdentity, snapshotMemberLearning, memberGuide, memberCheckReports, memberObservations, updateMemberLearning, recordMemberGuides };
