const { buildThenReview, classifyTeamPlan, parallelChecksMode, planPair, teamReviewer } = require("./collaboration.mjs");
const { reviewResult, reviewFormat } = require("./auto-team.cjs");

async function runFlow({ mode, agents, available = agents, lowMemory = false, stopped, runAgent, readReview, skipReview, savePlan,
  policy, saveVerdict, reviewStillCurrent, verifyRepair, repairAllowed = true,
  checkpointReview, smartSkip, alwaysReview = false, askForEvidence = false, turnsLeft = () => Infinity, pauseReview, scopedHandoff, discussion = false }) {
  if (discussion) {
    const [first, second] = agents;
    if (stopped() || !available.includes(first) || !available.includes(second)) return;
    const stage = { role: "review", kind: "discussion" };
    const opening = await runAgent(first, undefined, undefined, stage);
    if (stopped()) return;
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
    const reviewOnce = async (packet, peer, kind) => {
      const mayAsk = askForEvidence && kind === "review" && !limited && !packet.peerOnly && !packet.info.partial && turnsLeft() >= 4;
      const instructions = mayAsk ? reviewStage.instructions +
        "\nFor one material missing fact the builder can check without editing, you may instead start with AI_DECK_NEEDS_EVIDENCE and state exactly one question." : reviewStage.instructions;
      const result = await runAgent(reviewer, packet, peer, { ...reviewStage, instructions, kind });
      if (stopped() || result.status !== "completed") return null;
      if (!await reviewStillCurrent(packet)) {
        saveVerdict({ verdict: "blocked", text: "The checkout changed during review or could not be verified." });
        return null;
      }
      const question = mayAsk && /^AI_DECK_NEEDS_EVIDENCE\r?\n([\s\S]+)$/u.exec(result.output?.trim() ?? "")?.[1].trim();
      if (question && question.length <= 700 && turnsLeft() >= 3) {
        const evidence = await runAgent(builder, undefined, { from: reviewer, kind: "evidence request", text: question }, {
          role: "review", kind: "answer evidence request",
          instructions: "Answer only the teammate's question from available evidence. Read-only. State what you checked and what remains unknown.",
        });
        if (stopped()) return null;
        if (evidence?.status !== "completed" || !evidence.output?.trim() || !await reviewStillCurrent(packet)) {
          saveVerdict({ verdict: "blocked", text: "The requested evidence could not be verified against the reviewed checkout.\n\n" + question });
          return null;
        }
        const next = await readReview("after-build", reviewer);
        if (stopped()) return null;
        if (!await reviewStillCurrent(packet)) {
          saveVerdict({ verdict: "blocked", text: "The checkout changed while preparing the evidence recheck." });
          return null;
        }
        return reviewOnce(next, { ...peer, kind: "evidence reply", text: evidence.output }, "recheck evidence");
      }
      const verdict = reviewResult(result.output);
      if (verdict.verdict === "pass" && packet.info.partial) verdict.verdict = "partial";
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
    const next = await readReview("after-build", reviewer);
    if (!await verifyRepair(review, next)) {
      saveVerdict({ verdict: "blocked", text: "The repair left the reviewed scope, changed Git staging, or produced no verifiable change." });
      return;
    }
    const repaired = { from: builder, kind: "repair", text: repair.output, status: repair.status };
    await checkpointReview?.(next, repaired, reviewer);
    if (stopped()) return;
    if (turnsLeft() < 1) {
      pauseReview?.(reviewer, "Turn limit reached. Recheck the saved repair diff when ready.");
      return;
    }
    await reviewOnce(next, repaired, "recheck");
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
