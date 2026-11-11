export function reviewCriteria(prompt) {
  const items = new Map();
  for (const [, id, scope, text] of prompt.matchAll(/^[ \t]*(R[1-9]\d?)(?:[ \t]+\[files:[ \t]*([^\]\r\n]+)\])?[ \t]*[:：][ \t]*(\S[^\r\n]*)/gmu)) {
    const files = scope?.split(",").map((file) => file.trim());
    const validFiles = files?.length <= 8 && files.every((file) =>
      /^[\w./-]+$/u.test(file) && file.split("/").every((part) => part && part !== "." && part !== ".."));
    if (!items.has(id)) items.set(id, { id, text: text.trim().slice(0, 260), ...(validFiles && { files: [...new Set(files)] }) });
    if (items.size === 8) break;
  }
  return items.size ? [...items.values()] : [{ id: "R1", text: "Verify the outcome and constraints in the user's request." }];
}

export function repairCriterionFocus(criteria, verdict, before, after, paths) {
  const results = verdict.criteria ?? [];
  const changed = results.filter(({ status }) => status !== "pass");
  const focused = changed.length === 1 && changed[0].status === "changes" && criteria.find(({ id }) => id === changed[0].id);
  if (criteria.length < 2 || results.length !== criteria.length || !focused?.files?.length || !paths?.length ||
      before.info.partial || after.info.partial || !paths.every((file) => focused.files.includes(file) && after.info.includedPaths.includes(file))) return;
  if (criteria.some(({ id, files }) => {
    const result = results.find((item) => item.id === id);
    return !files?.length || result?.evidence?.snapshot !== before.info.sha256 || result.evidence.partial ||
      !files.every((file) => result.evidence.paths.includes(file)) ||
      id !== focused.id && (result.evidence.checks.length > 0 || files.some((file) => paths.includes(file)));
  })) return;
  return { id: focused.id, kind: "repair", results: results.map((item) => item.id === focused.id ? item
    : { ...item, evidence: { ...item.evidence, retained: true } }) };
}

export function criterionResults(text, criteria) {
  const allowed = new Set(criteria.map(({ id }) => id));
  const results = new Map();
  const ambiguous = new Set();
  for (const match of (text ?? "").matchAll(/^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\*\*)?(R[1-9]\d?)(?:\*\*)?[ \t]+(PASS|CHANGES|BLOCKED)(?:\*\*)?[ \t]*(?:—|-|:)[ \t]*(\S[^\r\n]*)/gmu)) {
    const [, id, status, detail] = match;
    if (!allowed.has(id)) continue;
    if (results.has(id)) ambiguous.add(id);
    results.set(id, { id, status: status.toLowerCase(), detail: detail.trim().slice(0, 320) });
  }
  return [...results.values()].filter(({ id }) => !ambiguous.has(id));
}

export function recordCriteria(verdict, text, criteria, focus) {
  if (!criteria?.length) return verdict;
  const parsed = criterionResults(text, focus ? criteria.filter(({ id }) => id === focus.id) : criteria);
  const results = focus ? [...focus.results.filter(({ id }) => id !== focus.id), ...parsed] : parsed;
  const incomplete = results.length !== criteria.length || results.some(({ status }) => status !== "pass");
  return {
    ...verdict, criteria: results,
    ...(verdict.verdict === "pass" && incomplete && { verdict: "blocked",
      text: "The review did not substantiate all requested criteria.\n\n" + verdict.text }),
  };
}

export function criteriaReplyFormat(focus) {
  return "After the verdict, give one line per " + (focus ? "requested criterion (" + focus.id + ")" : "criterion") +
    " using R1 PASS — evidence, R1 CHANGES — finding, or R1 BLOCKED — missing evidence. Use the actual criterion ID. Cite the diff path or the E ID of the check you used. " +
    "Add extra lines only for a material caveat or unresolved issue. Omit a footer when there are none.";
}

export const emptyReviewNote = (line) => /^(?:review notes: none|ไม่มี check ที่ขาด)[.!]?$/iu.test(line.trim());

export function testCommandText(command) {
  return /^(?:"[^"]*[\\/](?:pwsh|powershell)(?:\.exe)?"|(?:pwsh|powershell)(?:\.exe)?)\s+-Command\s+(['"])(.*)\1$/iu
    .exec(command ?? "")?.[2] ?? command;
}

export function scopedEvidenceRequest(text, criteria, checks, approved = []) {
  const match = /^(?:AI_DECK_REVIEW: BLOCKED\r?\n)?AI_DECK_NEEDS_EVIDENCE: (R[1-9]\d?)\r?\nQuestion: ([^\r\n]{3,360}\?)\r?\nImpact: ([^\r\n]{3,200})\r?\nCheck: (none|[AE][1-9]\d*)\r?\n/u.exec(text?.trim() ?? "");
  if (!match || (match[2].match(/\?/gu) ?? []).length !== 1) return;
  const [, id, question, impact, check] = match;
  const extraNotes = text.trim().slice(match[0].length).split(/\r?\n/u)
    .filter((line) => line.trim() && !emptyReviewNote(line) && !criterionResults(line, criteria).length).join("\n").slice(0, 1000);
  const results = criterionResults(text, criteria);
  if (results.length !== criteria.length ||
      !results.every((item) => item.status === (item.id === id ? "blocked" : "pass")) ||
      !results.some((item) => item.id === id)) return;
  if (check.startsWith("A")) {
    const configured = approved.find(({ id }) => id === check);
    if (!configured || checks.some((result) => testCommandText(result.command) === configured.command && verifiedCheck(result))) return;
    return { id, question, impact, results, approvedCheck: check, extraNotes };
  }
  const recorded = check.startsWith("E") && checks[Number(check.slice(1)) - 1];
  if (check.startsWith("E") && (!recorded || recorded.freshness === "matched" && Number.isInteger(recorded.exitCode))) return;
  return { id, question, impact, results, extraNotes };
}

export function withCriterionEvidence(result, packet, focus) {
  if (!result.criteria) return result;
  return { ...result, criteria: result.criteria.map((item) => {
    if (focus && item.id !== focus.id) return item;
    const refs = [...new Set([...(item.detail.match(/\bE[1-9]\d*\b/gu) ?? []),
      ...(packet.checks ?? []).flatMap((check, index) => check.criterionId === item.id ? ["E" + (index + 1)] : [])])];
    const checks = refs.flatMap((ref) => {
      const check = packet.checks?.[Number(ref.slice(1)) - 1];
      return check ? [{ ref, ...check }] : [];
    });
    return { ...item, evidence: { snapshot: packet.info.sha256, paths: packet.info.includedPaths ?? [], checks, partial: packet.info.partial } };
  }) };
}

export function newReviewChecks(previous = [], next = []) {
  const key = ({ command, status, exitCode, freshness, output }) => JSON.stringify([command, status, exitCode, freshness, output]);
  const alreadySent = new Set(previous.map(key));
  return next.filter((check) => !alreadySent.has(key(check)));
}

export const verifiedCheck = ({ freshness, exitCode }) => freshness === "matched" && Number.isInteger(exitCode);

export function savedCriterionChecks(run, id) {
  const result = run.collaboration?.criterionResults?.find((item) => item.id === id);
  const evidence = result?.evidence;
  if (!run.reviewSnapshot?.sha256 || evidence?.snapshot !== run.reviewSnapshot.sha256 || evidence.partial) return;
  const checks = (evidence.checks ?? []).filter((check) => verifiedCheck(check) && (!check.criterionId || check.criterionId === id));
  if (checks.length) return { detail: result.detail, checks: checks.map((check) => ({ ...check, priorRun: true })) };
}

export function savedEvidenceCheckpoint(run) {
  const collaboration = run.collaboration;
  const checkpoint = collaboration?.reviewCheckpoint;
  if (!checkpoint?.packet) return checkpoint;
  if (checkpoint.focus) return checkpoint;
  const card = collaboration.handoffs?.findLast((item) => item.kind === "evidence reply" && item.evidenceDelta && item.criterionId &&
    item.previousReviewHash === checkpoint.packet.info.sha256 && item.sha256 === item.previousReviewHash && item.checks?.some(verifiedCheck));
  if (!card) return checkpoint;
  const criteria = collaboration.criteria ?? [];
  const reviewer = run.agents[checkpoint.reviewer];
  const reports = [reviewer?.answer, ...(reviewer?.messages ?? []).map(({ text }) => text).reverse()];
  const results = reports.map((text) => criterionResults(text, criteria)).find((items) => items.length === criteria.length &&
    items.some(({ id }) => id === card.criterionId) && items.every(({ id, status }) => status === (id === card.criterionId ? "blocked" : "pass")));
  if (!results) return checkpoint;
  const original = withCriterionEvidence({ criteria: results }, checkpoint.packet).criteria;
  return { ...checkpoint, focus: { id: card.criterionId, results: original },
    handoff: { from: card.from, kind: card.kind, text: card.summary },
    packet: { ...checkpoint.packet, checks: card.checks, body: "Source snapshot unchanged. Use the earlier criterion decisions and the saved test result.",
      info: { ...checkpoint.packet.info, includedPaths: [], evidenceDelta: true, previousReviewHash: card.previousReviewHash } } };
}
