export const prompts = {
  retry: "Fix duplicate retry jobs and cover simultaneous requests.",
  backoff: "Cap retry backoff at 30 seconds.",
  review: "Review the current changes.",
  tests: "Run the tests again.",
};

export const emptyWorkspace = { retry: false, backoff: false };

export const memory = [
  { id: "codex", name: "Retry guard rules", note: "Acquire an atomic claim before enqueueing a retry. Keep duplicate guards in place when changing the worker." },
  { id: "claude", name: "Queue invariants", note: "Concurrent requests for the same job should create one queue entry. Cover both callers in the regression test." },
];

export const files = {
  retry: {
    path: "src/queue/retry.ts",
    before: ["if (await hasRetry(jobId)) return;", "await enqueueRetry(jobId);"],
    after: ["const claimed = await claimRetry(jobId);", "if (!claimed) return;", "await enqueueRetry(jobId);"],
    finding: "Two callers can both pass hasRetry before either enqueues.",
    handoff: "Add a check for two simultaneous requests for the same job.",
  },
  backoff: {
    path: "src/queue/backoff.ts",
    before: ["return 1_000 * 2 ** attempt;"],
    after: ["return Math.min(30_000, 1_000 * 2 ** attempt);"],
    finding: "Exponential backoff exceeds 30 seconds starting at attempt 5.",
    handoff: "Verify both the 30-second cap and the original short delays.",
  },
};

export function fileContent(key, workspace) {
  const file = files[key];
  const signature = key === "retry"
    ? "export async function retry(jobId: string) {"
    : "export function backoff(attempt: number) {";
  const lines = workspace[key] ? file.after : file.before;
  return [signature, ...lines.map((line) => "  " + line), "}"].join("\n");
}

function concurrentEnqueues(claimBeforeEnqueue) {
  const queued = new Set();
  const claims = new Set();
  const jobIds = ["job-42", "job-42"];
  // Both callers check before either caller reaches the queue write.
  const admitted = jobIds.filter((id) => {
    const seen = claimBeforeEnqueue ? claims : queued;
    if (seen.has(id)) return false;
    if (claimBeforeEnqueue) claims.add(id);
    return true;
  });
  for (const id of admitted) queued.add(id);
  return admitted.length;
}

export function checkWorkspace(workspace, scope) {
  const cap = (attempt) => {
    const delay = 1_000 * 2 ** attempt;
    return workspace.backoff ? Math.min(30_000, delay) : delay;
  };
  const checks = {
    retry: [{ label: "Concurrent requests enqueue one retry", expected: 1, actual: concurrentEnqueues(workspace.retry) }],
    backoff: [
      { label: "Attempt 0 retains its short delay", expected: 1_000, actual: cap(0) },
      { label: "Attempt 8 stays within 30 seconds", expected: 30_000, actual: cap(8) },
    ],
  };
  const rows = scope === "all" ? [...checks.retry, ...checks.backoff] : checks[scope];
  return rows.map((row) => ({ ...row, pass: row.actual === row.expected }));
}

function intentFor(prompt) {
  const text = prompt.toLowerCase().replace(/^ช่วย\s*/u, "");
  if (/^(review|audit|inspect)\b|^(รีวิว|ตรวจ|สรุป)/u.test(text)) return "review";
  if (/^(run|rerun|test)\b|^(รัน|เทสต์|ทดสอบ)/u.test(text)) return "tests";
  if (/backoff|30\s*(?:s\b|sec|วิ)|แบ็กออฟ/u.test(text)) return "backoff";
  if (/duplicate|dedup|race condition|retry.*ซ้ำ|ซ้ำ.*retry|กดซ้ำ/u.test(text)) return "retry";
  return "inspect";
}

const event = (agent, kind, title, detail) => ({ agent, kind, title, detail });

export function makeTurn(id, prompt, workspace, config) {
  const intent = intentFor(prompt);
  const target = files[intent];
  const changed = Object.keys(files).filter((key) => workspace[key]);
  const context = memory.filter((entry) => config.sources.includes(entry.id)).map((entry) => `${entry.name} · ${entry.id}\n${entry.note}`);
  if (config.skill) context.push("Regression review · shared skill\nReproduce the problem, check the changed behavior, and report the evidence.");
  if (config.instructions.trim()) context.push("Shared instructions\n" + config.instructions);
  const contextText = context.join("\n\n") || "No shared context selected for this turn.";
  const steps = [{
    events: [
      event("codex", "message", "Reading the task", target ? "I’ll inspect " + target.path + " and prepare a focused change." : "I’ll inspect the current workspace."),
      event("codex", "tool", "Load shared context", contextText),
      event("claude", "message", "Checking in parallel", "I’ll look at the same context and verify the relevant behavior independently."),
      event("claude", "tool", "Load shared context", contextText),
    ],
  }];

  if (target) {
    steps.push({
      events: [
        event("codex", "tool", "Read " + target.path, fileContent(intent, workspace)),
        event("claude", "message", workspace[intent] ? "Guard already present" : "Found a regression case", workspace[intent] ? "The workspace already contains the requested fix. I’ll verify it again." : target.finding),
      ],
    });
    if (!workspace[intent]) {
      steps.push({
        patch: intent,
        approval: config.askBeforeEdits ? "patch" : undefined,
        events: [
          event("codex", "tool", "Propose edit", target.path),
          event("claude", "message", "Reviewing the proposed change", target.handoff),
        ],
      });
      steps.push({
        handoff: target.handoff,
        approval: config.manualHandoff ? "handoff" : undefined,
        events: [event("claude", "handoff", "Follow-up for Codex", target.handoff)],
      });
    }
    steps.push(checkStep(intent));
  } else if (intent === "tests") {
    steps.push(checkStep("all"));
  } else {
    const paths = changed.map((key) => files[key].path).join(", ");
    steps.push({
      events: [
        event("codex", "tool", "Inspect workspace", Object.values(files).map((file) => file.path).join("\n")),
        event("claude", "message", "Workspace review", changed.length ? "Changes in " + paths + "." : "The sample workspace is at its original revision."),
      ],
    });
    if (intent === "review" && changed.length) {
      for (const key of changed) steps.push(checkStep(key));
    } else if (intent === "inspect") {
      steps.push({
        events: [event("codex", "message", "Ready for a more specific task", "This sandbox can fix duplicate retries, cap retry backoff, review changes, or run its test suite.")],
      });
    }
  }

  return { id, prompt, config, steps, cursor: 0, status: "running", decisions: {}, checks: {} };
}

function checkStep(scope) {
  return {
    check: scope,
    events: [
      event("codex", "check", "Run workspace checks", "deck check " + scope),
      event("claude", "message", "Verifying the result", "I’ll check the observed result against the expected behavior."),
    ],
  };
}

export function advanceTurn(session, id, cursor, decision) {
  const current = session.turns.at(-1);
  if (current?.id !== id || current.cursor !== cursor || current.status !== "running") return session;
  const step = current.steps[cursor];
  if (step.approval && !decision) return session;
  const workspace = step.patch && decision !== "skipped"
    ? { ...session.workspace, [step.patch]: true }
    : session.workspace;
  const next = current.steps[cursor + 1];
  const turn = {
    ...current,
    cursor: next ? cursor + 1 : cursor,
    status: next ? "running" : "completed",
    decisions: step.patch || step.approval ? { ...current.decisions, [cursor]: decision || "approved" } : current.decisions,
    checks: step.check ? { ...current.checks, [cursor]: checkWorkspace(workspace, step.check) } : current.checks,
  };
  return { workspace, turns: [...session.turns.slice(0, -1), turn] };
}

const encoder = new TextEncoder();
const estimateTokens = (text) => Math.ceil(encoder.encode(text).length / 4);
const emptyUsage = () => ({ codex: { input: 0, output: 0 }, claude: { input: 0, output: 0 } });

export function summarizeUsage(turns) {
  const session = emptyUsage();
  let latest = emptyUsage();
  for (const turn of turns) {
    latest = emptyUsage();
    latest.codex.input = latest.claude.input = estimateTokens(turn.prompt);
    for (const [index, step] of turn.steps.slice(0, turn.cursor + 1).entries()) {
      for (const item of step.events) {
        const usage = latest[item.agent];
        if (item.kind === "tool" && !step.patch) {
          usage.input += estimateTokens(item.detail);
        } else {
          usage.output += estimateTokens(item.title + "\n" + item.detail);
        }
      }
      if (step.patch) latest.codex.output += estimateTokens(files[step.patch].after.join("\n"));
      if (turn.checks[index]) {
        const resultTokens = estimateTokens(JSON.stringify(turn.checks[index]));
        latest.codex.input += resultTokens;
        latest.claude.input += resultTokens;
      }
    }
    for (const agent of Object.keys(latest)) {
      session[agent].input += latest[agent].input;
      session[agent].output += latest[agent].output;
    }
  }
  return { latest, session };
}
