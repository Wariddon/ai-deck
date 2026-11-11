import { criterionResults, emptyReviewNote, verifiedCheck } from "./team-criteria.mjs";

export function reviewChecks(run) {
  const { collaboration, reviewSnapshot } = run;
  if (!reviewSnapshot?.sha256) return [];
  return collaboration?.handoffs?.filter((card) => card.sent && card.sha256 === reviewSnapshot.sha256)
    .flatMap((card) => card.checks ?? []) ?? [];
}

export function resolvedCheckNote(line, checks) {
  const marker = /^RESOLVED_CHECK (E[1-9]\d*)$/u.exec(line);
  const note = /^(?:Caveat:\s*)?(?:the )?(?:handoff(?:'s R[1-9]\d* line)?|builder(?:'s report)?) (?:says|said|reported) (?:that )?the (?:check(?: ID)?|test result) was (?:unavailable|pending),? but (?:recorded check )?(E[1-9]\d*) supplies it\.?$/iu.exec(line);
  const id = (marker ?? note)?.[1];
  if (!id) return false;
  const check = checks[Number(id.slice(1)) - 1];
  return Boolean(check && verifiedCheck(check) && check.exitCode === 0);
}

export function decideReview(run, current) {
  const { collaboration, reviewSnapshot } = run;
  const checks = reviewChecks(run);
  if (!current) return { decision: "evidence", reason: "The reviewed checkout changed." };
  if (checks.some((check) => verifiedCheck(check) && check.exitCode !== 0) || collaboration.verdict === "changes") {
    return { decision: "repair", reason: "A matched check failed or the reviewer requested changes." };
  }
  if (run.reviewPending || reviewSnapshot.partial || collaboration.preReviewChecksIncomplete ||
      !checks.some((check) => verifiedCheck(check) && check.exitCode === 0) || collaboration.verdict !== "pass") {
    return { decision: "evidence", reason: "The review or matching check is incomplete." };
  }
  if (!collaboration.criteria?.length || collaboration.criteria.some(({ id }) => {
    const result = collaboration.criterionResults?.find((item) => item.id === id);
    return result?.status !== "pass" || result.evidence?.snapshot !== reviewSnapshot.sha256 || result.evidence.partial ||
      result.evidence.checks?.some((check) => !verifiedCheck(check) || check.exitCode !== 0);
  })) return { decision: "evidence", reason: "A criterion lacks passing evidence for this snapshot." };
  const notes = (collaboration.findings ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (collaboration.reviewEarlierNotes || notes.some((line) => !emptyReviewNote(line) &&
      !criterionResults(line, collaboration.criteria).length && !resolvedCheckNote(line, checks))) {
    return { decision: "summarize", reason: "A reviewer note still needs interpretation." };
  }
  return { decision: "finish", reason: "All criteria and a matching check passed." };
}

export function decideGraph(prompt, graph) {
  const kinds = new Set(graph.rows.map(({ kind }) => kind));
  if (graph.ambiguous || !kinds.has("definition")) return { decision: "uncertain", reason: "The definition could not be resolved uniquely." };
  const asksForCalls = /\b(?:callers?|calls?|dispatch|invoke)\b|ผู้เรียก|เรียกใช้|ใครเรียก/iu.test(prompt);
  if (graph.partial || asksForCalls && !kinds.has("calls") ||
      kinds.has("possible") && /\b(?:all|every|runtime)\b|ทุก|ทั้งหมด/iu.test(prompt)) {
    return { decision: "expand_callers", reason: "The shortlist has unresolved or incomplete caller coverage." };
  }
  if (/\b(?:tests?|assertions?|regression)\b|เทสต์|ทดสอบ/iu.test(prompt) &&
      !graph.rows.some(({ file }) => /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./iu.test(file))) {
    return { decision: "read_tests", reason: "The task asks for tests and the shortlist contains no test file." };
  }
  return { decision: "use", reason: "The shortlist has the relations requested by the task." };
}

const edit = /\b(?:implement|patch|fix|refactor|rename|update|edit)\b|แก้|ปรับ|เพิ่ม|ลบ|เปลี่ยน/iu;
const inspect = /\b(?:inspect|review|audit|verify|check|read.only)\b|ตรวจ|เช็ก|เช็ค|ดูโค้ด/iu;
const explain = /\b(?:explain|what|why|how|hello|hi)\b|อธิบาย|อะไร|ทำไม|อย่างไร|สวัสดี/iu;
const explicitFileEdit = /^(?:please\s+)?(?:edit|modify|update)\s+(?:only\s+)?(?:the\s+file\s+)?[\w./-]+\.[a-z\d]+\b/iu;
const reviewAtStart = /^(?:please\s+|ช่วย\s*)?(?:inspect|review|audit|verify|check)\b|^(?:ช่วย\s*)?(?:ลอง\s*)?(?:ตรวจ|เช็ก|เช็ค|ดูโค้ด)/iu;
const thaiEditPermission = /(?:^|[\s,.!?，。！？])(?:ปรับแก้|แก้ไข|ปรับปรุง)ได้(?:เลย)?(?:\s*(?:ครับ|ค่ะ|นะ))?[.!。！\s]*$/u;
const restrictEdits = /\b(?:do not|don't|never)\s+(?:edit|change|modify)|\bread.only\b|(?:อย่า|ห้าม|ไม่ต้อง)\s*(?:เพิ่ง\s*)?(?:แก้|ปรับ)|ตรวจอย่างเดียว|แนะนำอย่างเดียว|อ่านอย่างเดียว/iu;

export function routeLocalIntent(prompt, previous) {
  const result = decideIntent(prompt, previous);
  const latest = prompt.trim();
  if (reviewAtStart.test(latest)) {
    if (result.decision === "review") return result;
    if (!restrictEdits.test(latest) && !latest.includes("หรือ") && thaiEditPermission.test(latest)) {
      return { decision: "edit", reason: "The request asks for a review and explicitly permits fixes." };
    }
  }
  if (result.decision === "chat" && /^(?:please\s+|ช่วย\s*)?(?:explain|what|why|how|hello|hi)\b|^(?:ช่วย\s*)?(?:อธิบาย|ทำไม|สวัสดี)/iu.test(latest)) return result;
  const asksAboutEditing = /[?？]|\b(?:do not|don't|never|cannot|can't|read.only|should i|how to|would you|or)\b|อย่า|ห้าม|ไม่ต้อง|อย่างไร|ทำไม|ไหม|มั้ย|หรือ|เสนอ/iu.test(latest.replace(/\b(?:do not|don't)\s+run\s+(?:the\s+)?tests?\b/giu, ""));
  const beginsWithEdit = /^(?:please\s+)?(?:implement|patch|fix|refactor|rename|update|edit|modify)\s+\S|^(?:ช่วย\s*)?(?:แก้|ปรับ|เพิ่ม|ลบ|เปลี่ยน)\s*\S/iu.test(latest);
  if (!asksAboutEditing && (explicitFileEdit.test(latest) || beginsWithEdit && result.decision === "edit")) {
    return { decision: "edit", reason: "The request directly instructs a workspace edit." };
  }
  return { decision: "clarify", reason: "Choose Ask only, Read-only review, or Edit files in Run controls." };
}

export function fallbackMessageIntent(prompt) {
  return reviewAtStart.test(prompt.trim())
    ? { decision: "review", reason: "The request starts with a review. Start by inspecting files with read-only access." }
    : { decision: "chat", reason: "The request is ambiguous. Answer before taking any file action." };
}

export function decideIntent(prompt, previous) {
  const latest = prompt.trim();
  if (/^(?:do it|go ahead|proceed|ทำเลย|จัดเลย)[.!?\s]*$/iu.test(latest)) {
    const proposed = previous?.reply && /\b(?:propose|plan|can|would|will)\b|เสนอ|จะแก้|จะปรับ|จะเพิ่ม/iu.test(previous.reply);
    return proposed && edit.test(previous.reply)
      ? { decision: "edit", reason: "The follow-up refers to a proposed edit." }
      : { decision: "clarify", reason: "The follow-up does not identify a specific proposed edit." };
  }
  if (restrictEdits.test(latest)) {
    return { decision: inspect.test(latest) ? "review" : "chat", reason: "The request restricts changes." };
  }
  const scores = { edit: edit.test(latest) ? 2 : 0, review: inspect.test(latest) ? 2 : 0, chat: explain.test(latest) ? 2 : 0 };
  const highest = Math.max(...Object.values(scores));
  const candidates = Object.keys(scores).filter((key) => scores[key] === highest);
  return highest && candidates.length === 1
    ? { decision: candidates[0], reason: "The latest request has one clear intent signal." }
    : { decision: "clarify", reason: "The latest request has competing or missing intent signals." };
}
