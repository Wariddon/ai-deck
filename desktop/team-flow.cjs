const { buildThenReview, classifyTeamPlan, planPair, teamReviewer } = require("./collaboration.mjs");

async function runFlow({ mode, agents, available = agents, lowMemory = false, stopped, runAgent, readReview, skipReview, savePlan }) {
  const pair = planPair(mode);
  if (pair) {
    const [planner, builder] = pair;
    if (!available.includes(planner)) return;
    const plan = await runAgent(planner);
    if (stopped()) return;
    await savePlan({ ...classifyTeamPlan(plan), from: planner, to: builder });
    return;
  }
  if (buildThenReview(mode)) {
    const [builder, reviewer] = agents;
    const built = available.includes(builder) ? await runAgent(builder) : { status: "limited" };
    if (stopped() || !available.includes(reviewer)) return;
    const limited = built?.status === "limited";
    if (built?.status !== "completed" && !limited) {
      skipReview("The build did not complete, so the final review was skipped.", reviewer);
      return;
    }
    const review = await readReview(limited ? "fallback" : "after-build", reviewer);
    if (stopped()) return;
    if (!review.hasChanges && !limited) {
      skipReview("The worktree has no changes to review.", reviewer);
      return;
    }
    await runAgent(reviewer, review, built.output ? { from: builder, kind: "build", text: built.output, status: built.status } : undefined);
    return;
  }

  const reviewer = teamReviewer(mode) ?? ({ "codex-review": "codex", claude: "claude" })[mode];
  const phase = agents.length > 1 && !available.includes(agents[0]) ? "fallback" : "before-run";
  const review = available.includes(reviewer) ? await readReview(phase, reviewer) : undefined;
  const run = (agent) => runAgent(agent, agent === reviewer ? review : undefined);
  if (lowMemory) {
    for (const agent of available) {
      if (stopped()) return;
      await run(agent);
    }
  } else if (!stopped()) {
    await Promise.all(available.map(run));
  }
}

module.exports = { runFlow };
