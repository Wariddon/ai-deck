const { samePath } = require("./recent-handoff.cjs");

function testCommand(command) {
  return /(?:^|[;&|\r\n]|\s-(?:c|lc|command)\s+)\s*["']?(?:[^\s"';&|]*[/\\])?(?:(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?test(?::[\w:-]+)?|node(?:\.exe)?\s+--test|(?:python3?\s+-m\s+)?pytest|python3?\s+-m\s+unittest|(?:bun|go|cargo|dotnet|mvn|gradlew(?:\.bat)?)\s+test)(?=$|[\s"';&|])/iu.test(command ?? "");
}

function statusEntries(raw, limit) {
  const paths = raw.split("\0");
  const incomplete = paths.pop() !== "" || raw.length >= limit;
  const entries = paths.slice(0, 200).map((entry) => ({ index: entry[0], worktree: entry[1], file: entry.slice(3) }));
  return { entries, truncated: incomplete || paths.length > entries.length };
}

function sameCheckout(left, right) {
  return Boolean(left?.stamp && right?.stamp && samePath(left.cwd, right.cwd) &&
    left.branch === right.branch && left.head === right.head && left.stamp === right.stamp);
}

function testReports(runs, checkout) {
  return [...runs].reverse().flatMap((run) => [...(run.evidence ?? [])].reverse()
    .filter((item) => item.kind === "command" && testCommand(item.subject)).map((item) => ({
      id: run.id + ":" + item.agent + ":" + item.id, ...item,
      freshness: !item.checkout?.stamp || !checkout.stamp ? "unknown" : sameCheckout(item.checkout, checkout) ? "matched"
        : !samePath(item.checkout.cwd, checkout.cwd) ? "other" : "changed",
    }))).slice(0, 12);
}

function reviewTestChecks(run, checkout, history = []) {
  const current = testReports([run], checkout);
  const seen = new Set(current.map(({ subject }) => subject));
  const previous = testReports(history, checkout).filter(({ subject, freshness }) => {
    if (freshness !== "matched" || seen.has(subject)) return false;
    seen.add(subject);
    return true;
  });
  return [...current, ...previous].slice(0, 6).map(({ id, subject, status, exitCode, freshness, output }) => ({
    command: subject, status, exitCode, freshness,
    ...(previous.some((entry) => entry.id === id) && { priorRun: true }),
    ...(freshness === "matched" && output && { output: output.length > 600 ? output.slice(0, 600) + "…" : output }),
  }));
}

module.exports = { testCommand, statusEntries, sameCheckout, testReports, reviewTestChecks };
