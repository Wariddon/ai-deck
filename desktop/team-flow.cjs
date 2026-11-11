const { buildThenReview, classifyTeamPlan, parallelChecksMode, planPair, teamReviewer } = require("./collaboration.mjs");
const { reviewResult, reviewFormat } = require("./auto-team.cjs");
const { criteriaReplyFormat, newReviewChecks, recordCriteria, repairCriterionFocus, scopedEvidenceRequest, verifiedCheck, withCriterionEvidence } = require("./team-criteria.mjs");

async function runFlow({ mode, agents, available = agents, lowMemory = false, stopped, runAgent, readReview, skipReview, savePlan,
  policy, saveVerdict, reviewStillCurrent, verifyRepair, repairAllowed = true,
  checkpointReview, smartSkip, alwaysReview = false, askForEvidence = false, turnsLeft = () => Infinity, pauseReview, scopedHandoff, discussion = false, criteria = [],
  approvedEvidenceChecks = [], runEvidenceCheck }) {
  if (discussion) {
    const [first, second] = agents;
    if (stopped() || !available.length) return;
    const stage = { role: "review", kind: "discussion" };
    if (available.length === 1) {
      const [agent] = available;
      await runAgent(agent, undefined, undefined, { ...stage, limitedPeer: agent === first ? second : first });
      return;
    }
    const opening = await runAgent(first, undefined, undefined, stage);
    if (stopped()) return;
    if (opening?.status === "limited") {
      await runAgent(second, undefined, undefined, { ...stage, limitedPeer: first });
      return;
    }
    if (opening?.status !== "completed" || !opening.output?.trim()) {
      skipReview("The opening reply was unavailable. The teammate was not called.", second);
      return;
    }
    await runAgent(second, undefined, { from: first, kind: "discussion reply", text: opening.output }, stage);
    return;
  }
  const pair = planPair(mode);
  if (pair) {
    const [planner, builder] = pair;
    if (!available.includes(planner)) return;
    const plan = await runAgent(planner);
    if (stopped()) return;
    await savePlan({ ...classifyTeamPlan(plan), from: planner, to: builder });
    return;
  }
  if (mode === parallelChecksMode) {
    const packet = await readReview("before-run");
    const check = (agent) => runAgent(agent, packet, undefined, { role: "review", kind: "independent check",
      instructions: agent === agents[0]
        ? "Check the implementation and trace likely causes or risks. Leave test coverage and reproduction to your teammate."
        : "Check tests, reproduction steps, and observed outcomes. Leave implementation analysis to your teammate." });
    if (lowMemory) {
      for (const agent of available) {
        if (stopped()) return;
        await check(agent);
      }
    } else if (!stopped()) await Promise.all(available.map(check));
    return;
  }
  if (buildThenReview(mode)) {
    const [builder, reviewer] = agents;
    const built = available.includes(builder) ? await runAgent(builder) : { status: "limited" };
    if (stopped() || !available.includes(reviewer) && !policy) return;
    const limited = built?.status === "limited";
    if (built?.status !== "completed" && !limited) {
      if (available.includes(reviewer)) skipReview("The build did not complete, so the final review was skipped.", reviewer);
      return;
    }
    let review = await readReview(limited ? "fallback" : "after-build", reviewer);
    if (stopped()) return;
    if (!review.hasChanges && !limited) {
      if (!alwaysReview || !built.output?.trim()) {
        skipReview("The builder produced no new changes to review.", reviewer);
        return;
      }
      review = { ...review, peerOnly: true };
    }
    const handoff = { from: builder, kind: review.peerOnly ? "peer report" : "build", text: built.output, status: built.status };
    if (!policy) {
      await runAgent(reviewer, review, built.output ? handoff : undefined);
      return;
    }
    if (policy === "smart" && !limited && await smartSkip?.(review)) {
      skipReview("Smart verified the single text file and Git whitespace check. No model review was needed.", reviewer);
      return;
    }
    if (stopped()) return;
    if (!limited) await checkpointReview?.(review, handoff, reviewer);
    if (!available.includes(reviewer)) return;
    if (turnsLeft() < 1) {
      pauseReview?.(reviewer, "Turn limit reached. The review can continue from this diff.");
      return;
    }
    const reviewStage = { role: "review", instructions: reviewFormat +
      " Keep the verdict and findings concise. After the verdict line, use the language of the user's request unless they asked for a different language." };
    const summaryReserve = policy === "economy" ? 0 : 1;
    const reviewOnce = async (packet, peer, kind, focus) => {
      const budget = turnsLeft();
      const canAskBuilder = budget >= 3 + summaryReserve;
      const eligibleChecks = budget >= 2 ? approvedEvidenceChecks : [];
      const mayAsk = askForEvidence && kind === "review" && !limited && !packet.peerOnly && !packet.info.partial &&
        (canAskBuilder || criteria.length > 0 && eligibleChecks.length > 0);
      const instructions = [reviewStage.instructions,
        criteria.length > 0 && criteriaReplyFormat(focus),
        focus && (focus.kind === "repair" ? "Reassess only " + focus.id + " using the revised diff for its declared files. The other file-local criteria retain their earlier decisions."
          : "Only reassess " + focus.id + ". The source snapshot is unchanged. Use the earlier decisions and newly supplied evidence. Do not re-review the other criteria."),
        mayAsk && (criteria.length
          ? "Ask only if exactly one criterion remains blocked, all others pass, and the missing evidence can change the verdict. First reuse any supplied matching result. When asking, replace the verdict line with AI_DECK_NEEDS_EVIDENCE: R1. Then add Question: one specific question ending in ?, Impact: what decision this changes, and " +
            (canAskBuilder ? "Check: a matching saved or recorded check ID, or none." : "Check: a matching saved A ID. If no saved check matches, report the criterion as blocked.") +
            " Put each field on its own line and follow with all criterion lines."
          : "For one material missing fact the builder can check without editing, you may instead start with AI_DECK_NEEDS_EVIDENCE and state exactly one question."),
        mayAsk && eligibleChecks.length > 0 && "If a configured check can settle the gap, use its A ID in Check. AI Deck runs only the matching saved command. Approved checks:\n" +
          eligibleChecks.map(({ id, name, command }) => id + " · " + name + " · " + command).join("\n"),
      ].filter(Boolean).join("\n");
      const result = await runAgent(reviewer, packet, peer, { ...reviewStage, instructions, kind, focus });
      if (stopped() || result.status !== "completed") return null;
      if (!await reviewStillCurrent(packet)) {
        saveVerdict({ verdict: "blocked", text: "The checkout changed during review or could not be verified." });
        return null;
      }
      const request = mayAsk && criteria.length && scopedEvidenceRequest(result.output, criteria, packet.checks ?? [], eligibleChecks);
      const question = request ? request.id + " · " + request.question + "\nDecision affected: " + request.impact :
        mayAsk && !criteria.length && /^AI_DECK_NEEDS_EVIDENCE\r?\n([\s\S]+)$/u.exec(result.output?.trim() ?? "")?.[1].trim();
      if (question && question.length <= 700 && turnsLeft() >= (request?.approvedCheck ? 1 : 2 + summaryReserve)) {
        const observed = request && withCriterionEvidence({ criteria: request.results }, packet).criteria;
        if (observed) request.results = observed;
        const evidence = request?.approvedCheck
          ? await runEvidenceCheck?.(request, packet)
          : await runAgent(builder, undefined, { from: reviewer, kind: "evidence request", text: question }, {
          role: "review", kind: "answer evidence request",
          focus: request || undefined,
          instructions: "Answer only the teammate's question from available evidence. Read-only. State what you checked and what remains unknown.",
        });
        if (stopped()) return null;
        if (evidence?.status !== "completed" || !evidence.output?.trim() || !await reviewStillCurrent(packet)) {
          saveVerdict({ verdict: "blocked", text: "The requested evidence could not be verified against the reviewed checkout.\n\n" + question, criteria: observed });
          return null;
        }
        const next = request?.approvedCheck ? packet : await readReview("after-build", reviewer);
        if (stopped()) return null;
        if (!request?.approvedCheck && !await reviewStillCurrent(packet)) {
          saveVerdict({ verdict: "blocked", text: "The checkout changed while preparing the evidence recheck." });
          return null;
        }
        const scoped = request ? { ...next, checks: [...(evidence.checks ?? []), ...newReviewChecks(packet.checks, next.checks)],
          body: "Source snapshot unchanged. Use the prior criterion decisions and the new evidence below.",
          info: { ...next.info, includedPaths: [], evidenceDelta: true, previousReviewHash: packet.info.sha256 } } : next;
        const reply = { ...peer, ...(request?.approvedCheck && { from: "checks" }), kind: "evidence reply", text: evidence.output };
        if (request && scoped.checks?.some(verifiedCheck)) await checkpointReview?.(scoped, reply, reviewer, request);
        if (stopped()) return null;
        return reviewOnce(scoped, reply, "recheck evidence", request || undefined);
      }
      const verdict = withCriterionEvidence(recordCriteria(reviewResult(result.output), result.output, criteria, focus), packet, focus);
      if (focus?.extraNotes) verdict.extraNotes = focus.extraNotes;
      if (focus && (focus.kind === "repair" || packet.checks?.some(verifiedCheck)) &&
          (verdict.malformed || !verdict.criteria?.some(({ id }) => id === focus.id))) return null;
      if (verdict.verdict === "pass" && limited) {
        verdict.verdict = "partial";
        verdict.text = "The builder reached its usage limit. The review covers the available changes while implementation is still pending.\n\n" + verdict.text;
      } else if (verdict.verdict === "pass" && packet.info.partial) verdict.verdict = "partial";
      else if (verdict.verdict === "pass" && packet.peerOnly) verdict.verdict = "report";
      saveVerdict(verdict);
      return verdict;
    };
    const verdict = await reviewOnce(review, handoff, "review");
    if (stopped() || !repairAllowed || policy !== "thorough" || turnsLeft() < 2 || limited || verdict?.verdict !== "changes" || review.info.partial || review.peerOnly ||
        !review.info.includedPaths?.length || !await reviewStillCurrent(review)) return;
    const repair = await runAgent(builder, undefined, { from: reviewer, kind: "review findings", text: verdict.text }, {
      role: "write", kind: "repair", repairOf: review,
      instructions: "Fix only the actionable review findings inside these paths: " + JSON.stringify(review.info.includedPaths) +
        ". Leave other files, HEAD and staging alone. Stop and explain if the fix needs a broader scope.",
    });
    if (stopped() || repair.status !== "completed") return;
    const next = await readReview("after-build", reviewer, criteria.length ? review : undefined);
    if (!await verifyRepair(review, next)) {
      saveVerdict({ verdict: "blocked", text: "The repair left the reviewed scope, changed Git staging, or produced no verifiable change." });
      return;
    }
    const repaired = { from: builder, kind: "repair", text: repair.output, status: repair.status };
    const focus = !next.info.partial && next.repairDelta && repairCriterionFocus(criteria, verdict, review, next.repairDelta, next.repairedPaths);
    const packet = focus ? { ...next.repairDelta, fullInfo: next.info,
      checks: (next.repairDelta.checks ?? []).filter((check) => check.freshness === "matched") } : next;
    await checkpointReview?.(packet, repaired, reviewer, focus);
    if (stopped()) return;
    if (turnsLeft() < 1) {
      pauseReview?.(reviewer, "Turn limit reached. Recheck the saved repair diff when ready.");
      return;
    }
    await reviewOnce(packet, repaired, "recheck", focus);
    return;
  }

  const reviewer = teamReviewer(mode) ?? ({ "codex-review": "codex", claude: "claude" })[mode];
  const phase = agents.length > 1 && !available.includes(agents[0]) ? "fallback" : "before-run";
  const review = available.includes(reviewer) ? await readReview(phase, reviewer) : undefined;
  const run = (agent, handoff) => runAgent(agent, agent === reviewer ? review : undefined, handoff);
  if (lowMemory) {
    let handoff;
    for (const [index, agent] of available.entries()) {
      if (stopped()) return;
      const result = await run(agent, handoff);
      if (scopedHandoff && index === 0 && available.length > 1 && !stopped()) handoff = await scopedHandoff(agent, result);
    }
  } else if (!stopped()) {
    await Promise.all(available.map((agent) => run(agent)));
  }
}

module.exports = { runFlow };
