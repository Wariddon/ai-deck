const { readFileSync } = require("node:fs");
const path = require("node:path");

const references = path.join(__dirname, "skills", "ai-deck-team-review", "references");
const guides = new Map();

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

function teamReviewGuidance(options, role, stage) {
  if (options?.teamReviewSkill !== true) return [];
  if (stage === "answer evidence request") return [guide("receive-review", "Evidence reply", "receiving-code-review")];
  if (stage === "repair") return [guide("receive-review", "Repair", "receiving-code-review")];
  const section = { write: "Builder", review: "Reviewer", summary: "Lead" }[role];
  if (!section) return [];
  return [
    guide("verify-evidence", section, "verification-before-completion"),
    ...(role === "write" && options.traceBug ? [guide("trace-bug", "Builder", "systematic-debugging")] : []),
  ];
}

module.exports = { teamReviewGuidance };
