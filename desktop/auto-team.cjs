const { validateAssignments, formatRequiredChecks } = require("./team-contract.cjs");

const agents = ["codex", "claude"];
const peer = (agent) => agent === "codex" ? "claude" : "codex";
const labels = { codex: "Codex", claude: "Claude Code" };
const reviewFormat = "Start with exactly AI_DECK_REVIEW: PASS, AI_DECK_REVIEW: CHANGES, or AI_DECK_REVIEW: BLOCKED, then a newline and your findings. PASS means no actionable findings on the evidence you could inspect. List missing checks separately. Use CHANGES for fixes within the approved assignment and BLOCKED for missing information or changes requiring a new plan.";

function parsePlan(output, allowSplit, checkoutHead) {
  const match = /^AI_DECK_AUTO: (CODEX|CLAUDE|SPLIT|NEEDS_INPUT|BLOCKED)\r?\n([\s\S]+)$/u.exec(output?.trim() ?? "");
  if (!match || !match[2].trim() || match[2].length > 12000) {
    return { state: "unclassified", text: "The team did not return a complete assignment. Ask for a concise plan." };
  }
  const [, choice, text] = match;
  if (choice === "SPLIT" && !allowSplit) return { state: "blocked", text: "Separate edits require two clean worktrees at the same base. Replan with a single writer." };
  if (choice === "NEEDS_INPUT" || choice === "BLOCKED") return { state: choice === "NEEDS_INPUT" ? "needs-input" : "blocked", text };
  const builder = choice === "CLAUDE" ? "claude" : "codex";
  const strategy = choice === "SPLIT" ? "split" : "single";
  try {
    const body = JSON.parse(text);
    if (typeof body?.summary !== "string" || !body.summary.trim() || body.summary.length > 4000) throw new Error("Summarize the plan and any risks.");
    const requiredBase = typeof body.requiredBase === "string" ? body.requiredBase.trim() : "";
    if (checkoutHead && !/^\S{1,256}$/u.test(requiredBase)) {
      throw new Error("Set requiredBase to the verified checkout HEAD if the work can start here. Use NEEDS_INPUT if it requires a different checkout.");
    }
    if (checkoutHead && requiredBase.toLowerCase() !== checkoutHead.toLowerCase()) {
      return { state: "needs-input", requiredBase,
        text: `The plan requires ${requiredBase}, but this worktree is at ${checkoutHead.slice(0, 12)}. ` +
          "Choose the required checkout and replan, or ask the team for a plan that starts here.\n\n" + body.summary.trim() };
    }
    const assignments = validateAssignments(body.assignments, strategy === "split" ? agents : [builder]);
    return { state: "ready", text: body.summary.trim(), strategy, builder, assignments, ...(checkoutHead && { requiredBase: checkoutHead }) };
  } catch (error) {
    return { state: "unclassified", text: error instanceof SyntaxError ? "The team did not return a structured assignment. Ask it to replan." : error.message };
  }
}

function reviewResult(output) {
  const match = /^AI_DECK_REVIEW: (PASS|CHANGES|BLOCKED)\r?\n([\s\S]+)$/u.exec(output?.trim() ?? "");
  return match && match[2].trim() ? { verdict: match[1].toLowerCase(), text: match[2].slice(0, 10000) }
    : { verdict: "blocked", malformed: true, text: "The reviewer did not return a verdict.\n\n" + (output ?? "").slice(0, 10000) };
}

function stopResult(status, agent, detail) {
  return { status: ["limited", "interrupted"].includes(status) ? status : "blocked", agent, detail };
}

async function planAutoTeam({ state, allowSplit, checkoutHead, checkoutRefs = [], stopped, turn, progress, checkpoint, assignmentEvidence }) {
  const planner = state.planner ?? "codex";
  const reviewer = peer(planner);
  const checkoutEvidence = checkoutHead && `AI Deck verified the current worktree HEAD as ${checkoutHead}. ` +
    "Plan against this checkout. Treat a required change of checkout, branch or base commit as a blocker and identify what is missing.";
  const refEvidence = checkoutRefs.length && "Git's locally recorded ref tips (reference metadata, separate from the current worktree):\n" +
    checkoutRefs.map(({ ref, commit }) => `${ref} at ${commit}`).join("\n");
  if (!state.proposal) {
    progress(planner, "propose");
    const proposal = await turn(planner, { role: "plan", instructions: [
      "Propose a team assignment. Identify relevant paths, dependencies and acceptance tests. Prefer two writers when the task can be split into independent work with disjoint paths. Otherwise recommend one writer and one reviewer. Include questions and blockers.",
      checkoutEvidence,
      refEvidence,
    ].filter(Boolean).join("\n") });
    if (stopped() || proposal.status !== "completed" || !proposal.output?.trim()) {
      return stopResult(stopped() ? "interrupted" : proposal.status, planner, "The initial proposal did not finish.");
    }
    state.proposal = proposal.output.slice(0, 10000);
    checkpoint();
  }
  if (stopped()) return stopResult("interrupted");
  const dependencies = allowSplit && await assignmentEvidence?.(state.proposal);
  if (stopped()) return stopResult("interrupted");
  progress(reviewer, "negotiate");
  const options = { role: "plan", handoff: { from: planner, kind: "proposal", text: state.proposal },
    instructions: [
      "Independently check the proposal against the checkout. Resolve omissions and overlapping edits. Decide each agent’s assignment using the task and written responsibilities.",
      checkoutEvidence,
      refEvidence,
      allowSplit ? "Choose SPLIT if there are two meaningful, independent sets of files to edit. State exactly which paths each agent may edit and what to check on the combined diff. Choose one writer if the edits overlap or depend on each other."
        : "Use a single writer and assign the other agent independent review. Separate worktrees are unavailable for this checkout.",
      dependencies,
      "Start with exactly one line: AI_DECK_AUTO: CODEX (Codex writes), AI_DECK_AUTO: CLAUDE (Claude writes), " +
        "AI_DECK_AUTO: SPLIT (both write), AI_DECK_AUTO: NEEDS_INPUT, or AI_DECK_AUTO: BLOCKED. Output only the marker and value on that line.",
      'For CODEX, CLAUDE or SPLIT, follow the marker with one JSON object and no code fence. Shape: {"requiredBase":"full commit hash","summary":"steps and risks","assignments":{"codex":{"task":"its job","paths":["src/a.js"],"acceptance":["observable outcome"]},"claude":{"task":"its job","paths":[],"acceptance":["observable outcome"]}}}.',
      checkoutHead && "Use a writer decision only when the work can start on the verified HEAD. Set requiredBase to the full commit hash above. If another checkout is necessary, use NEEDS_INPUT and name the required checkout and why it is needed.",
      "Give each writer exact repository-relative files or directories with a trailing slash. A reviewer has an empty paths array. SPLIT writers must be independent. For NEEDS_INPUT or BLOCKED, give the question or blocker in plain text.",
      "For SPLIT, each assignment's acceptance criteria must be verifiable in its own worktree. Put cross-worktree criteria in the summary for final integration.",
    ].filter(Boolean).join("\n") };
  let decision = await turn(reviewer, options);
  let plan = parsePlan(decision.output, allowSplit, checkoutHead);
  if (!stopped() && decision.status === "completed" && plan.state === "unclassified") {
    decision = await turn(reviewer, { ...options, instructions: options.instructions + "\nCorrect the previous plan: " + plan.text });
    plan = parsePlan(decision.output, allowSplit, checkoutHead);
  }
  if (stopped() || decision.status !== "completed") return stopResult(stopped() ? "interrupted" : decision.status, reviewer, "The team decision did not finish.");
  return { status: plan.state === "ready" ? "approval" : "blocked", plan };
}

async function executeAutoTeam({ state, plan, lowMemory, stopped, turn, progress, checkpoint, reviewInput, combine, verifySingle }) {
  const split = plan.strategy === "split";
  const writers = split ? agents : [plan.builder];
  async function step(id, agent, phase, options) {
    if (stopped()) return stopResult("interrupted", agent);
    if (state.results[id]) return null;
    progress(agent, phase);
    const assignment = plan.assignments?.[options.lane ?? plan.builder];
    const ownAssignment = plan.assignments?.[agent];
    const laneNote = split && options.lane && "This is " + labels[options.lane] +
      "’s isolated worktree. The other writer’s changes are absent here by design. Check only this assignment. Save cross-worktree requirements for the combined checkout.";
    const criteria = options.lane ? [...(assignment?.acceptance ?? []),
      ...(!split && options.role === "review" ? ownAssignment?.acceptance ?? [] : [])] :
      Object.values(plan.assignments ?? {}).flatMap(({ acceptance }) => acceptance);
    const instructions = [
      options.instructions, laneNote,
      options.role === "write" && ownAssignment && "Your approved assignment: " + ownAssignment.task,
      options.role === "review" && options.lane && assignment && "Assignment under review: " + assignment.task +
        "\nPaths under review: " + assignment.paths.join(", "),
      options.role === "write" && assignment && "Approved write paths: " + assignment.paths.join(", "),
      criteria?.length ? "Acceptance criteria to verify:\n" + criteria.map((item) => "- " + item).join("\n") : "",
    ].filter(Boolean).join("\n\n");
    const scoped = { ...options, instructions, ...(options.role === "write" && assignment && { scope: assignment.paths }) };
    if (options.handoff) {
      state.handoffs ??= {};
      const { text, checks, ...details } = options.handoff;
      state.handoffs[id] = { ...details, to: agent, text: text?.slice(0, 2400), checks: checks?.slice(0, 6800) };
      checkpoint();
    }
    let result = await turn(agent, scoped);
    let verdict = options.role === "review" && reviewResult(result.output);
    if (!stopped() && result.status === "completed" && verdict?.malformed) {
      result = await turn(agent, { ...scoped, instructions: scoped.instructions +
        "\nYour previous response was missing the verdict. Use the supplied evidence and start with the exact verdict line. Do not emit tool-call syntax." });
      verdict = reviewResult(result.output);
    }
    if (stopped() || result.status !== "completed") {
      return stopResult(stopped() ? "interrupted" : result.status, agent, labels[agent] + " paused during " + phase + ".");
    }
    state.results[id] = { ...(verdict || { text: result.output?.slice(0, 10000) ?? "" }), ...result.handoff };
    checkpoint();
    return null;
  }
  const build = (writer) => step(writer + "-build", writer, "implement", { role: "write", lane: writer,
    instructions: "Implement only your approved assignment. Preserve existing work. Do not stage or commit. Report edited paths, observed tests and any remaining work." });
  if (split && !lowMemory) {
    const outcomes = await Promise.allSettled(writers.map(build));
    const failure = outcomes.find(({ status }) => status === "rejected");
    if (failure) throw failure.reason;
    const paused = outcomes.find(({ value }) => value);
    if (paused) return paused.value;
  } else {
    for (const writer of writers) {
      const paused = await build(writer);
      if (paused) return paused;
    }
  }
  for (const writer of writers) {
    const reviewer = peer(writer);
    const build = state.results[writer + "-build"];
    for (let round = 0; round <= 1; round++) {
      const reviewId = writer + "-review-" + round;
      if (!state.results[reviewId]) {
        if (stopped()) return stopResult("interrupted", reviewer);
        progress(reviewer, "prepare-review");
        const input = await reviewInput(writer);
        const fix = state.results[writer + "-fix"];
        const paused = await step(reviewId, reviewer, round ? "recheck" : "review", { role: "review", lane: writer, ...input,
          handoff: { from: writer, kind: round ? "revision" : "implementation summary", text: fix?.text ?? build.text,
            files: fix?.files ?? build.files, checks: input.checks, next: "Review this assignment against its acceptance criteria." },
          instructions: "Check " + labels[writer] + "’s assignment, its actual diff and the recorded test evidence. " + reviewFormat });
        if (paused) return paused;
      }
      const review = state.results[reviewId];
      if (review.verdict === "pass") break;
      if (review.verdict !== "changes" || round) return stopResult("needs-review", reviewer, "Open findings need your decision.");
      const paused = await step(writer + "-fix", writer, "revise", { role: "write", lane: writer,
        handoff: { from: reviewer, kind: "review findings", text: review.text, files: review.files ?? build.files,
          checks: review.checks, next: "Fix the findings in your approved paths and rerun the relevant checks." },
        instructions: "Address the peer findings within the approved scope. Inspect the current files, rerun relevant checks when permitted and report any unresolved findings." });
      if (paused) return paused;
    }
  }
  const verify = split ? combine : verifySingle;
  if (!verify) return { status: "reviewed" };
  const verifier = peer(plan.builder);
  async function finalCheck(id) {
    if (stopped()) return stopResult("interrupted");
    const outcome = await verify(async (input) => {
      if (!split || input.requiredChecks?.some(({ status }) => status !== "passed")) return null;
      return step(id, verifier, "integration", { role: "review", ...input,
        instructions: "Review the combined candidate against both assignments. Distinguish individual worktree results from the required checks run on this candidate. " + reviewFormat });
    });
    if (outcome) return outcome;
    if (state.requiredChecks?.some(({ status }) => status !== "passed")) return { status: "checks-failed" };
    if (split && state.results[id]?.verdict !== "pass") return stopResult("needs-review", verifier, "Combined changes have open findings.");
    return null;
  }
  if (!state.checkRepair) {
    const failed = await finalCheck("integration");
    if (failed?.status !== "checks-failed") return failed ?? { status: "reviewed" };
    const failures = state.requiredChecks.filter(({ status }) => status !== "passed");
    if (failures.some(({ status }) => status !== "failed")) {
      return { status: "checks-failed", detail: failed.detail || "Required checks did not finish on a verifiable checkout. Review their results." };
    }
    state.checkRepair = failures;
    checkpoint();
  }
  for (const writer of writers) {
    const failures = state.checkRepair.filter(({ owner }) => !split || owner === "both" || owner === writer);
    if (!failures.length) continue;
    const checks = formatRequiredChecks(failures);
    const paused = await step(writer + "-check-fix", writer, "revise", { role: "write", lane: writer,
      handoff: { from: "checks", kind: "required checks", text: "Required checks failed on the final checkout.", checks,
        files: state.results[writer + "-build"]?.files, next: "Fix the cause within your approved paths. Keep the check itself intact." },
      instructions: "Fix the required check failures within your approved paths. Do not weaken or remove checks." });
    if (paused) return paused;
    const id = writer + "-check-review";
    if (!state.results[id]) {
      const input = await reviewInput(writer);
      const halted = await step(id, peer(writer), "recheck", { role: "review", lane: writer, ...input,
        handoff: { from: writer, kind: "required check revision", text: state.results[writer + "-check-fix"].text,
          files: state.results[writer + "-check-fix"].files, checks, next: "Review the correction before AI Deck reruns required checks." },
        instructions: "Review the correction to the required check failures. " + reviewFormat });
      if (halted) return halted;
    }
    if (state.results[id].verdict !== "pass") return stopResult("needs-review", peer(writer), "The required check correction needs review.");
  }
  const result = await finalCheck("integration-recheck");
  return result?.status === "checks-failed"
    ? { status: "checks-failed", detail: "Required checks still failed after one repair round. Open Team results to inspect the output." }
    : result ?? { status: "reviewed" };
}

module.exports = { planAutoTeam, executeAutoTeam, parsePlan, reviewResult, reviewFormat };
