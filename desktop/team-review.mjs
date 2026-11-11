const priorities = { blocker: 0, major: 1, nit: 2 };
const normalize = (value) => value.trim().replace(/[ \t]+/gu, " ").toLowerCase();

export function freshReviewPrompt() {
  return [
    "Review independently using the current request, shared brief and supplied source evidence.",
    "First verify the intended outcome, acceptance criteria, scope and assumptions. Check whether existing code can meet the goal with a smaller change.",
    "Treat teammate reports as claims to verify. Report a missing requirement or unverified assumption only when it affects the outcome.",
    "For each actionable issue, add one line: FINDING MAJOR | path:line | issue and supporting evidence. Use BLOCKER for a stopping issue, MAJOR for a required fix, or NIT for a minor improvement.",
    "Use the actual affected path and line when available, or use scope 'brief' for a specification gap. Omit finding lines when there are none. Keep the required verdict and criterion lines.",
  ].join("\n");
}

export function mergeReviewFindings(previous = [], text, reviewer) {
  const next = previous.map((finding) => ({ ...finding, reviewers: [...finding.reviewers] }));
  // Quoted examples and fenced source are evidence, not reviewer dispositions.
  let fence;
  const report = (text ?? "").split(/\r?\n/u).filter((line) => {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return false;
    }
    return !fence;
  }).join("\n");
  for (const [, severity, scope, detail] of report.matchAll(
    /^[ \t]*(?:[-*][ \t]+)?FINDING[ \t]+(BLOCKER|MAJOR|NIT)[ \t]*\|[ \t]*([^|\r\n]{1,240})[ \t]*\|[ \t]*([^\r\n]{1,700})$/gmu)) {
    const key = normalize(scope) + "\n" + normalize(detail);
    const existing = next.find((finding) => finding.key === key);
    if (existing) {
      if (!existing.reviewers.includes(reviewer)) existing.reviewers.push(reviewer);
      if (priorities[severity.toLowerCase()] < priorities[existing.severity]) existing.severity = severity.toLowerCase();
    } else if (next.length < 40) {
      next.push({ id: "F" + (next.length + 1), key, severity: severity.toLowerCase(),
        scope: scope.trim(), detail: detail.trim(), reviewers: [reviewer] });
    }
  }
  return next;
}

export function sharedBriefPrompt(brief, decisions = []) {
  return [
    brief?.brief && "Goal and shared context:\n" + brief.brief,
    brief?.constraints && "Constraints:\n" + brief.constraints,
    brief?.outcome && "Acceptance and handoff:\n" + brief.outcome,
    brief?.questions && "Open questions to verify before relying on assumptions:\n" + brief.questions,
    decisions.length && "User-approved decisions for this checkout:\n" + decisions.map(({ text }) => "- " + text).join("\n"),
  ].filter(Boolean).join("\n\n");
}
