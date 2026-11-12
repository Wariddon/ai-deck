// Deterministic naming: no additional model request, and no teammate/system prompt.
function suggestedSessionTitle(prompt, limit = 65) {
  if (typeof prompt !== "string") return "New task";
  let text = prompt.trim();
  for (let i = 0; i < 4; i++) {
    const next = text.replace(/^(?:current user task|task from the user|user task|current task|original task):\s*/iu, "");
    if (next === text) break;
    text = next;
  }
  const line = text.split(/\r?\n/u).find(line => line.trim()) ?? "";
  return [...line.trim().replace(/\s+/gu, " ")].slice(0, limit).join("") || "New task";
}
module.exports = { suggestedSessionTitle };
