import { normalizeSessionTeam } from "./session-team.mjs";

export function supportsTeamDirection(team) {
  return team?.members?.length === 2 && ["codex", "claude"].every((provider) => team.members.some((member) => member.provider === provider));
}

export function teamDirection(team, mode) {
  if (mode === "team-discussion") return "discuss";
  if (!supportsTeamDirection(team) || team.topology === "tree") return "custom";
  const [first, second] = team.members;
  return first.position === "write" && second.position === "review" ? first.provider : "custom";
}

export function changeTeamDirection(team, direction) {
  if (!supportsTeamDirection(team)) throw new Error("Use Session Team to arrange teams with other members.");
  if (!["codex", "claude", "discuss"].includes(direction)) throw new Error("Choose a supported team direction.");
  if (direction === "discuss") return normalizeSessionTeam({ ...team, interaction: "discuss", useByDefault: true });
  const writer = team.members.find((member) => member.position === "write");
  const reviewer = team.members.find((member) => member.position === "review");
  const order = [direction, direction === "codex" ? "claude" : "codex"];
  const members = order.map((provider, index) => ({ ...team.members.find((member) => member.provider === provider),
    position: index === 0 ? "write" : "review", instructions: (index === 0 ? writer : reviewer)?.instructions ?? "" }));
  return normalizeSessionTeam({ ...team, members, interaction: undefined, topology: undefined, useByDefault: true });
}
