const { createHash } = require('node:crypto');
const { readWorkContract } = require('./work-contract.mjs');
const { sameCheckout } = require('./delivery.cjs');
const { testCommandText } = require('./team-criteria.mjs');
const { observedCheckOutcome } = require('./claude-command-result.cjs');
const { evaluateEvidenceAssertions } = require('./work-assertions.mjs');
const { readEvidenceArtifacts, captureWorkArtifacts, artifactsMatch } = require('./work-evidence-artifacts.cjs');

const commandKey = command => testCommandText(command).trim();

function evaluateContract(contract, { observation, checks, artifacts, documents, current }) {
  const conditions = (contract.readyWhen ?? []).map(condition => {
    const references = (contract.evidenceRefs ?? []).filter(ref => ref.condition === condition);
    const files = [...new Set(references.flatMap(ref => ref.paths))].map(file => ({ ...artifacts.get(file), ...(!current && { status: 'unverified' }) }));
    const selected = command => checks.find(check => commandKey(check.command) === commandKey(command));
    const tests = [...new Set(references.flatMap(ref => ref.checks))].map(command => {
      const check = selected(command);
      return { command, status: current ? observedCheckOutcome(check) : 'unverified',
        ...(check && { freshness: check.freshness }),
        ...(check?.artifactSnapshot && { observedAt: check.artifactSnapshot.observedAt, host: check.artifactSnapshot.host }),
        ...(current && check?.freshness === 'matched' && Number.isInteger(check.exitCode) && { exitCode: check.exitCode }),
        ...(current && check?.freshness === 'matched' && check.completionSource && { completionSource: check.completionSource }) };
    });
    const recorded = Boolean(current && references.length && files.concat(tests).length && files.every(file => file.status === 'recorded') && tests.every(test => test.status === 'passed'));
    let changedReceipt = false;
    const receiptsMatched = references.every(ref => {
      if (!ref.assertions?.length) return true;
      const outcomes = ref.checks.map(command => {
        const check = selected(command), saved = check?.artifactSnapshot?.files;
        if (!saved || observedCheckOutcome(check) !== 'passed') return 'missing';
        const savedFiles = new Map(saved.map(file => [file.path, file]));
        if (!ref.paths.every(file => savedFiles.get(file)?.status === 'recorded')) return 'missing';
        return artifactsMatch(ref.paths, savedFiles, artifacts) ? 'matched' : 'changed';
      });
      const matched = outcomes.includes('matched');
      if (!matched && outcomes.includes('changed')) changedReceipt = true;
      return matched;
    });
    const assertions = evaluateEvidenceAssertions(references.flatMap(ref => ref.assertions ?? []), documents, recorded && receiptsMatched && tests.length > 0);
    const stale = !current || changedReceipt || tests.some(test => ['changed', 'other'].includes(test.freshness));
    const status = !references.length ? 'unverified' : stale ? 'stale'
      : tests.some(test => test.status === 'failed') || assertions.some(assertion => assertion.status === 'failed') ? 'failed'
      : recorded && assertions.length && assertions.every(assertion => assertion.status === 'passed') ? 'verified'
      : recorded && !assertions.length ? 'evidence recorded' : 'incomplete';
    return { condition, status, required: references.length > 0, files, tests, ...(assertions.length && { assertions }),
      ...(status === 'stale' && { reason: 'The checkout or recorded artifact changed after its check.' }),
      ...(status === 'incomplete' && { reason: 'A referenced file, completed check, valid JSON value or command-time artifact observation is missing.' }) };
  });
  return { proofVersion: 2, head: observation?.head, stamp: current ? observation?.stamp : undefined, current, conditions };
}

// Read only on explicit command completion or handoff, never execute condition text.
async function collectWorkEvidence(value, options) {
  return (await collectWorkEvidenceBatch({ single: value }, options)).single ??
    { head: options.observation?.head, current: false, conditions: [] };
}

function workEvidencePrompt(evidence) {
  return evidence?.conditions.length ? 'Observed handoff evidence (file presence/hash and test outcomes support the named conditions; they do not prove every semantic requirement):\n' +
    'Only verified predicates have current command-bound artifacts. Recorded evidence is not a general semantic pass; incomplete, stale and failed references still need work. Host platform is not the target environment.\n' + JSON.stringify(evidence) : '';
}
function requiredCheckEvidence(definitions, execution, observation) {
  const snapshot = execution?.checkSnapshot;
  const hash = createHash('sha256').update(JSON.stringify(definitions ?? [])).digest('hex');
  if (!sameCheckout(snapshot?.observation, observation) || snapshot.checksHash !== hash) return [];
  return (execution.requiredChecks ?? []).flatMap(result => {
    const check = definitions.find(check => check.name === result.name);
    if (!check || result.commandHash !== createHash('sha256').update(JSON.stringify(check.command)).digest('hex') ||
        !Number.isInteger(result.code) || !(result.status === 'passed' && result.code === 0 || result.status === 'failed' && result.code !== 0)) return [];
    return [{ command: check.command, exitCode: result.code, freshness: 'matched', status: result.status, source: 'required-check',
      ...(result.artifactSnapshot && { artifactSnapshot: result.artifactSnapshot }) }];
  });
}

const unmetObservableConditions = records => Object.values(records ?? {}).flatMap(evidence =>
  (evidence.conditions ?? []).filter(condition => (condition.required || condition.assertions?.length) &&
    !(condition.status === 'verified' && evidence.proofVersion === 2 || !condition.assertions?.length && condition.status === 'evidence recorded')));

async function collectWorkEvidenceBatch(contracts, options) {
  const entries = Object.entries(contracts).filter(([, contract]) => contract.readyWhen?.length).map(([id, value]) => [id, readWorkContract(value)]);
  if (!entries.length) return {};
  const values = entries.map(([, contract]) => contract), first = await readEvidenceArtifacts(values, options.cwd);
  const after = options.observe ? await Promise.resolve().then(options.observe).catch(() => null) : options.observation;
  const last = await readEvidenceArtifacts(values, options.cwd);
  const readable = [...first.artifacts].filter(([, file]) => file.status === 'recorded').map(([file]) => file);
  const current = sameCheckout(options.observation, after) && artifactsMatch(readable, first.artifacts, last.artifacts);
  return Object.fromEntries(entries.map(([id, contract]) => [id, evaluateContract(contract,
    { observation: options.observation, checks: options.checks ?? [], ...first, current })]));
}

module.exports = { collectWorkEvidence, collectWorkEvidenceBatch, captureWorkArtifacts, workEvidencePrompt, requiredCheckEvidence, unmetObservableConditions };
