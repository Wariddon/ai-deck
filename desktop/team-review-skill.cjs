const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const references = path.join(__dirname, "skills", "ai-deck-team-review", "references");
const guides = new Map();
let fingerprint;

function guide(file, section, name) {
  if (!guides.has(file)) {
    const [, ...blocks] = readFileSync(path.join(references, file + ".md"), "utf8").split(/^## /mu);
    guides.set(file, new Map(blocks.map((block) => {
      const end = block.indexOf("\n");
      return [block.slice(0, end).trim(), block.slice(end + 1).trim()];
    })));
  }
  const text = guides.get(file).get(section);
  if (!text) throw new Error("Missing bundled AI Deck Team Review guidance for " + section + ".");
  return { name, text };
}

function reviewFocus(packet) {
  const body = typeof packet === "string" ? packet : typeof packet?.body === "string" ? packet.body : "";
  const paths = Array.isArray(packet?.changedPaths) ? packet.changedPaths : Array.isArray(packet?.info?.includedPaths) ? packet.info.includedPaths :
    [...body.matchAll(/^\+\+\+ (?:b\/|"b\/)([^\r\n]+)/gmu)].map((match) => match[1].replace(/"$/u, ""));
  const code = paths.some(file => /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|[ch]|cpp|vue|svelte|rb|php|sh|ps1|sql)$/iu.test(file));
  const changed = body.split(/\r?\n/u).filter(line => /^[+-]/u.test(line) && !/^[+-]{3}/u.test(line)).join("\n");
  const failurePath = code && /\b(?:try|catch|throw|reject|retry|fallback|timeout|onerror|localStorage|sessionStorage|writeFile|fetch)\b|\.catch\s*\(/iu.test(changed);
  return { code, failurePath };
}

function teamReviewGuidance(options, role, stage, evidence) {
  if (options?.teamReviewSkill !== true) return [];
  if (stage === "answer evidence request") return [guide("receive-review", "Evidence reply", "receiving-code-review")];
  if (stage === "repair") return [guide("receive-review", "Repair", "receiving-code-review")];
  if (role === "plan") return options.sharedWork === false ? [] : [guide("plan-work", "Planner", "writing-plans")];
  const section = { write: "Builder", review: "Reviewer", summary: "Lead" }[role];
  if (!section) return [];
  const focus = role === "review" ? reviewFocus(evidence) : {};
  return [
    guide("verify-evidence", section, "verification-before-completion"),
    ...(role === "write" && options.sharedWork !== false ? [guide("plan-work", "Builder", "writing-plans")] : []),
    ...(focus.code ? [guide("test-quality", "Reviewer", "pr-test-analyzer")] : []),
    ...(focus.failurePath ? [guide("silent-failures", "Reviewer", "silent-failure-hunter")] : []),
    ...(role === "write" && options.traceBug ? [guide("trace-bug", "Builder", "systematic-debugging")] : []),
  ];
}

function teamReviewFingerprint(options) {
  if (options?.teamReviewSkill !== true) return null;
  if (fingerprint) return fingerprint;
  // Hash all conditional guidance too: a queued or held review must not change
  // instructions silently just because its current diff selects another guide.
  const entries = [["verify-evidence", "Reviewer"], ["verify-evidence", "Builder"], ["verify-evidence", "Lead"],
    ["plan-work", "Planner"], ["plan-work", "Builder"], ["test-quality", "Reviewer"], ["silent-failures", "Reviewer"],
    ["receive-review", "Evidence reply"], ["receive-review", "Repair"], ["trace-bug", "Builder"]];
  return fingerprint = createHash("sha256").update(JSON.stringify(entries.map(([file, section]) => guide(file, section, file).text))).digest("hex");
}

function recordReviewSkill(run, agent, stage, guidance) {
  if (!guidance.length) return;
  const owner = run.collaboration ?? run.autoTeam ?? run.teamReview;
  if (!owner) return;
  const applied = owner.skillUsage ??= [];
  const skills = ["ai-deck-team-review", ...guidance.map(({ name }) => name)];
  const existing = applied.find(entry => entry.agent === agent && entry.stage === stage);
  if (existing) existing.skills = [...new Set([...existing.skills, ...skills])];
  else applied.push({ agent, stage, skills, guideHash: teamReviewFingerprint({ teamReviewSkill: true }) });
}

module.exports = { teamReviewGuidance, teamReviewFingerprint, recordReviewSkill };
