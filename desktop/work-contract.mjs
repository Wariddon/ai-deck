const fields = { inputs: "Inputs to verify", outputs: "Outputs to hand over", readyWhen: "Handoff conditions to verify" };

export const workPlanInstructions = "Start your final answer with exactly one of these lines: AI_DECK_PLAN: READY, AI_DECK_PLAN: NEEDS_INPUT, or AI_DECK_PLAN: BLOCKED. Use READY only when the next agent has enough information to implement. " +
  'For READY, add a newline and one JSON object without a code fence: {"summary":"paths, steps, tests and risks","inputs":["required interface or evidence"],"outputs":["deliverable and check evidence"],"readyWhen":["observable condition for handing work over"]}. ' +
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
  return result;
}

export function workContractPrompt(value, label = "Work contract from the saved plan") {
  const contract = readWorkContract(value);
  const sections = Object.entries(fields).filter(([key]) => contract[key]?.length)
    .map(([key, title]) => title + ":\n" + contract[key].map(item => "- " + item).join("\n"));
  return sections.length ? label + ":\n" + sections.join("\n") +
    "\nThese are requirements, not evidence of completion. Verify needed inputs before dependent edits; " +
    "continue independent work where possible and identify unmet conditions. A reviewer may inspect incomplete work. " +
    "Report delivered outputs, observed checks and remaining conditions separately. Keep the existing permissions and file scope." : "";
}

export function workContractMarkdown(value) {
  const contract = readWorkContract(value);
  return Object.entries(fields).filter(([key]) => contract[key]?.length).map(([key, title]) =>
    "### " + title + "\n\n" + contract[key].map(item => "- " + item).join("\n")).join("\n\n");
}
