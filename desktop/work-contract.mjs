import { normalizeEvidenceAssertions } from './work-assertions.mjs';
const fields = { inputs: "Inputs to verify", outputs: "Outputs to hand over", readyWhen: "Handoff conditions to verify" };

export const workEvidenceInstructions =
  'Optionally add "evidenceRefs":[{"condition":"exact readyWhen text","paths":["relative/source.js"],"checks":["exact test command to verify"]}] to connect observable conditions to files and test evidence. Do not invent check outcomes. ' +
  'For a measurable result, optionally add "assertions":[{"path":"metrics.json","pointer":"/typing/p95Ms","operator":"atMost","value":100}] to its evidence reference; include that JSON path and the actual check command that produces or verifies it. Allowed operators are equals, atMost and atLeast. Use actual expected values from the task or explain the proposed budget; do not invent measurements. ' +
  'Checks may be exact build, API or UI verification commands as well as tests. Run them through the native tools with existing permissions after the plan is saved; AI Deck records bounded artifact hashes at completion. Old receipts without that observation stay incomplete. For API/UI receipts assert the exact environment and target fields as well as the requested behavior; a local response must not certify production. Include a bounded screenshot path for UI evidence when useful; its hash records the image, not a visual pass. State unsupported or missing evidence instead of substituting model prose. ';

export const runWorkContracts = run => [...Object.values(run.workContracts ?? {}), ...Object.values(run.teamReview?.plans ?? {})];
export const workCheckCommands = run => [...new Set(runWorkContracts(run).flatMap(contract =>
  (contract.evidenceRefs ?? []).flatMap(ref => ref.checks ?? [])))].slice(0, 24);

export const workPlanInstructions = "Start your final answer with exactly one of these lines: AI_DECK_PLAN: READY, AI_DECK_PLAN: NEEDS_INPUT, or AI_DECK_PLAN: BLOCKED. Use READY only when the next agent has enough information to implement. " +
  'For READY, add a newline and one JSON object without a code fence: {"summary":"paths, steps, tests and risks","inputs":["required interface or evidence"],"outputs":["deliverable and check evidence"],"readyWhen":["observable condition for handing work over"]}. ' +
  workEvidenceInstructions +
  "Each list has up to six concrete items of at most 300 characters. These are requirements, not claims of completed work. For NEEDS_INPUT or BLOCKED, give the question or blocker in plain text.";

// Optional on older plans. Keep explicit contracts bounded and reject malformed
// fields instead of silently dropping a prerequisite from an approved plan.
export function readWorkContract(value) {
  const result = {};
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(value ?? {}, key)) continue;
    const items = value[key];
    if (!Array.isArray(items) || items.length > 6 || items.some(item =>
      typeof item !== "string" || !item.trim() || item.length > 300)) {
      throw new Error(`Give ${key} as up to six concrete items of at most 300 characters each.`);
    }
    result[key] = [...new Set(items.map(item => item.trim()))];
  }
  if (Object.hasOwn(value ?? {}, 'evidenceRefs')) {
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 6) throw new Error('Keep up to six evidence references.');
    result.evidenceRefs = value.evidenceRefs.map(ref => {
      if (!ref || !(result.readyWhen ?? []).includes(ref.condition)) throw new Error('Evidence must name an exact handoff condition.');
      const lists = Object.fromEntries(['paths', 'checks'].map(key => {
        const items = ref[key] ?? [];
        if (!Array.isArray(items) || items.length > 4 || items.some(item => typeof item !== 'string' || !item.trim() || item.length > 300 || /[\u0000-\u001f]/u.test(item))) throw new Error('Use up to four bounded evidence references.');
        if (key === 'paths' && items.map(item => item.trim()).some(item => /[\\:]/u.test(item) || item.startsWith('/') || item.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))) throw new Error('Use repository-relative evidence paths.');
        return [key, [...new Set(items.map(item => item.trim()))]];
      }));
      if (!lists.paths.length && !lists.checks.length) throw new Error('Supply a file or observed check reference.');
      const assertions = Object.hasOwn(ref, 'assertions') ? normalizeEvidenceAssertions(ref.assertions, lists.paths) : undefined;
      if (assertions?.length && !lists.checks.length) throw Error('Observable assertions also need a referenced check command.');
      return { condition: ref.condition, ...lists, ...(assertions && { assertions }) };
    });
  }
  return result;
}

export function workContractPrompt(value, label = "Work contract from the saved plan") {
  const contract = readWorkContract(value);
  const sections = Object.entries(fields).filter(([key]) => contract[key]?.length)
    .map(([key, title]) => title + ":\n" + contract[key].map(item => "- " + item).join("\n"));
  return sections.length ? label + ":\n" + sections.join("\n") +
    (contract.evidenceRefs?.length ? '\nEvidence references to verify (do not execute unapproved commands):\n' + JSON.stringify(contract.evidenceRefs) : '') +
    "\nThese are requirements, not evidence of completion. Verify needed inputs before dependent edits; " +
    "continue independent work where possible and identify unmet conditions. A reviewer may inspect incomplete work. " +
    "Report delivered outputs, observed checks and remaining conditions separately. Keep the existing permissions and file scope." : "";
}

export function workContractMarkdown(value) {
  const contract = readWorkContract(value);
  return Object.entries(fields).filter(([key]) => contract[key]?.length).map(([key, title]) =>
    "### " + title + "\n\n" + contract[key].map(item => "- " + item).join("\n")).join("\n\n");
}
