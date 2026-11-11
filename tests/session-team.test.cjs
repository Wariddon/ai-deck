const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { teamProvidersClient } = require("../desktop/team-providers.cjs");
const { supplementalReviewDiff } = require("../desktop/review-snapshot.cjs");
const { normalizeSessionTeam, sessionMemberInputs, sessionMemberPrompt, redactSupplementalPrompt, sessionTeamIssue,
  sessionTeamOrder, sessionTeamBatches, sessionMemberBlock, teamParentChoices, promoteTeamLead, removeTreeMember } = require("../desktop/session-team.mjs");
const { defaultDraftMode } = require("../desktop/collaboration.mjs");

const member = (provider, name, model, position = "review") =>
  ({ id: "member-" + randomUUID(), provider, name, position, model, instructions: "List missing checks." });

function branchFixture() {
  const members = Array.from({ length: 6 }, (_, index) => member("codex", "AI" + (index + 1), ""));
  return members.map((entry, index) => ({ ...entry, parentId: index === 0 ? null : members[[0, 0, 0, 1, 2, 2][index]].id }));
}

test("a team map validates one lead and runs dependency levels in order", () => {
  const members = branchFixture();
  const [lead, left, right, leaf, ...rest] = members;
  const tree = normalizeSessionTeam({ topology: "tree", members: [leaf, left, right, ...rest, lead] });
  assert.deepEqual(sessionTeamOrder(tree).map(({ name }) => name), ["AI1", "AI2", "AI3", "AI4", "AI5", "AI6"]);
  assert.throws(() => normalizeSessionTeam({ topology: "tree", members: [lead, { ...left, parentId: null }] }), /one team lead/);
  assert.throws(() => normalizeSessionTeam({ topology: "tree", members: [lead, { ...left, parentId: leaf.id }, leaf] }), /without loops/);
  assert.throws(() => normalizeSessionTeam({ topology: "tree", members: [lead, { ...left, parentId: right.id }] }), /one team lead/);
  assert.deepEqual(normalizeSessionTeam({ members }).members.map(({ parentId }) => parentId), Array(6).fill(undefined));
});

test("editing the team map prevents cyclic drops and keeps branches connected on removal", () => {
  const members = branchFixture();
  const [lead, left, right, leaf] = members;
  assert.deepEqual(teamParentChoices(members, left.id).map(({ name }) => name), ["AI1", "AI3", "AI5", "AI6"]);
  const promoted = normalizeSessionTeam({ topology: "tree", members: promoteTeamLead(members, leaf.id) });
  assert.equal(sessionTeamOrder(promoted)[0].id, leaf.id);
  assert.equal(promoted.members.find(({ id }) => id === lead.id).parentId, left.id);
  const removed = normalizeSessionTeam({ topology: "tree", members: removeTreeMember(members, lead.id) });
  assert.equal(sessionTeamOrder(removed)[0].id, left.id);
  assert.equal(removed.members.find(({ id }) => id === right.id).parentId, left.id);
  assert.equal(removeTreeMember(members, left.id).find(({ id }) => id === leaf.id).parentId, lead.id);
});

test("branch batches pair at most one Gemini and one Ollama at the same level and honor Low RAM", () => {
  const providers = ["gemini", "ollama", "gemini", "codex", "ollama", "gemini"];
  const members = branchFixture().map((entry, index) => ({ ...entry, provider: providers[index], model: index === 3 ? "" : "fixture" }));
  const team = normalizeSessionTeam({ topology: "tree", members, parallelBranches: true, summaryMemberId: members[0].id });
  assert.equal(team.summaryMemberId, members[0].id);
  assert.deepEqual(sessionTeamBatches(team, false).map((batch) => batch.map(({ name }) => name)),
    [["AI1"], ["AI2", "AI3"], ["AI4"], ["AI5", "AI6"]]);
  assert.deepEqual(sessionTeamBatches(team, true).map((batch) => batch.length), [1, 1, 1, 1, 1, 1]);
  assert.throws(() => normalizeSessionTeam({ ...team, summaryMemberId: "missing" }), /wrap-up/);
  assert.equal(normalizeSessionTeam({ ...team, topology: "sequence" }).summaryMemberId, undefined);
});

test("an unavailable child only blocks a sequential team; a branching team requires its lead", () => {
  const members = branchFixture();
  const availability = { connections: { codex: { status: "ready" } }, geminiConfigured: false };
  const child = { ...members[1], provider: "gemini" };
  const options = { members: [members[0], child], ...availability };
  assert.equal(sessionTeamIssue({ ...options, topology: "tree" }), "");
  assert.match(sessionTeamIssue(options), /Gemini API key/);
  assert.equal(sessionMemberBlock(child, availability).status, "skipped");
  assert.match(sessionTeamIssue({ ...options, topology: "tree", connections: {} }), /AI1.*Codex/);
});

test("a session can save two different models on the same provider", () => {
  const members = [member("codex", "Builder", "model-a", "write"), member("codex", "Reviewer", "model-b")];
  const team = normalizeSessionTeam({ members, useByDefault: true });
  assert.deepEqual(team.members, members);
  assert.equal(defaultDraftMode({ sessionTeam: team }), "session-team");
  assert.equal(defaultDraftMode({ sessionTeam: { ...team, useByDefault: false }, runHistory: [{ mode: "session-team" }] }), "build-review");
  assert.throws(() => normalizeSessionTeam({ members: [member("gemini", "Writer", "gemini-flash", "write")] }), /Select Codex or Claude/);
  assert.throws(() => normalizeSessionTeam({ members: [member("ollama", "Local", "")] }), /Choose a model/);
});

test("handoff prompts include identity, responsibility and the prior member’s report", () => {
  const builder = member("codex", "Builder", "model-a", "write");
  const reviewer = member("gemini", "Reviewer", "gemini-flash");
  const prompt = sessionMemberPrompt({ prompt: "Fix the test", member: reviewer, members: [builder, reviewer],
    handoffs: [{ name: builder.name, text: "Updated the test." }] });
  assert.match(prompt, /You are Reviewer, the Reviewer/);
  assert.match(prompt, /Builder \(Builder\) → Reviewer \(Reviewer\)/);
  assert.match(prompt, /Builder:\nUpdated the test/);
  assert.doesNotMatch(prompt, /Git evidence/);
});

test("legacy teams keep private reports and history out of supplemental prompts, including derived reports", () => {
  const native = member("codex", "Builder", "");
  const external = { ...member("gemini", "Reviewer", "gemini-flash"), instructions: "" };
  const local = member("ollama", "Coordinator", "local:latest");
  const team = normalizeSessionTeam({ members: [native, external, local] });
  assert.equal(team.shareReports, false);
  const shared = { userPrompt: "new user task", projectPrompt: "private workspace instructions", prior: "old private run" };
  const sources = [{ name: "Builder", text: "private native report", projectData: true },
    { name: "Planner", text: "plain report", projectData: false }];
  const localInputs = sessionMemberInputs({ member: local, team, ...shared, diff: "tracked project diff", handoffs: sources });
  assert.equal(localInputs.projectData, true);
  const handoffs = [...sources, { name: local.name, text: "report quoting the diff", projectData: localInputs.projectData }];
  const inputs = sessionMemberInputs({ member: external, team, ...shared, handoffs });
  assert.equal(inputs.prompt, shared.userPrompt);
  assert.equal(inputs.prior, "");
  assert.deepEqual(inputs.handoffs, [sources[1]]);
  assert.equal(inputs.projectData, false);
  assert.equal(sessionMemberInputs({ member: { ...external, instructions: "Private individual instructions" },
    team, ...shared, handoffs }).projectData, true);
  const optedIn = sessionMemberInputs({ member: external, team: { ...team, shareReports: true }, ...shared, handoffs });
  assert.equal(optedIn.prior, ""); // Fresh reviewers still omit old conversation history.
  assert.equal(sessionMemberInputs({ member: external, team: { ...team, shareReports: true, freshReview: false }, ...shared, handoffs }).prior, shared.prior);
  assert.deepEqual(optedIn.handoffs, handoffs);
  const nativeInputs = sessionMemberInputs({ member: native, team, ...shared, handoffs });
  assert.equal(nativeInputs.prompt, shared.projectPrompt);
  assert.deepEqual(nativeInputs.handoffs, handoffs);
});

test("a missing Gemini key or a native usage limit blocks sending before the runner", () => {
  const members = [member("gemini", "Planner", "gemini-flash"), member("claude", "Reviewer", "")];
  const connections = { claude: { status: "ready", usageLimit: { resetAt: 2000 } } };
  assert.match(sessionTeamIssue({ members, connections, now: 1000 }), /Gemini API key/);
  assert.match(sessionTeamIssue({ members, connections, geminiConfigured: true, now: 1000 }), /Claude Code.*usage limit/);
  assert.equal(sessionTeamIssue({ members, connections, geminiConfigured: true, now: 2000 }), "");
});

test("outbound prompts redact known credentials and exact configured keys", () => {
  const credential = "test-current-key";
  const gemini = "AQ." + "x".repeat(32);
  const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nexample\n-----END OPENSSH PRIVATE KEY-----";
  const prompt = "keep this\n" + [credential, gemini, pem].join("\n");
  assert.equal(redactSupplementalPrompt(prompt, credential), "keep this\n[credential removed]\n[credential removed]\n[private key removed]");
});

test("external review exports tracked text only and hides sensitive and untracked paths", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ai-deck-review-diff-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const git = (cwd, args) => execFileSync("git", ["-c", "core.hooksPath=NUL", "-c", "commit.gpgSign=false",
    "-c", "user.name=QA", "-c", "user.email=qa@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (name, text) => fs.writeFileSync(path.join(folder, name), text);
  git(folder, ["init", "-q"]);
  write("source file.txt", "before\n");
  write(".env", "fake-secret-before\n");
  write("binary.dat", Buffer.from([0, 1, 2]));
  git(folder, ["add", "."]);
  git(folder, ["commit", "-qm", "fixture"]);
  write("source file.txt", "public change\n");
  write(".env", "fake-secret-after\n");
  write("binary.dat", Buffer.from([0, 5, 2]));
  write("untracked.txt", "private untracked content\n");
  const diff = await supplementalReviewDiff(git, folder);
  assert.match(diff, /\+public change/);
  assert.match(diff, /Some tracked changes were omitted/);
  assert.doesNotMatch(diff, /\.env|fake-secret|binary\.dat|untracked/);
  assert.doesNotMatch(await supplementalReviewDiff(async () => "malformed without a header", folder), /malformed/);
});

test("Gemini sends its key in the header and uses the selected text model", async () => {
  const requests = [];
  const client = teamProvidersClient({ fetcher: async (url, options) => {
    requests.push({ url, options });
    if (url.includes("pageSize")) return Response.json({ models: [
      { name: "models/gemini-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-embed", supportedGenerationMethods: ["embedContent"] },
    ] });
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: "internal" }, { text: "review complete" }] } }],
      usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 4, thoughtsTokenCount: 7, totalTokenCount: 29 } });
  } });
  assert.deepEqual(await client.list("gemini", "fixture-key"), [{ value: "gemini-flash", label: "Flash" }]);
  const reply = await client.run("gemini", { model: "gemini-flash", prompt: "handoff", key: "fixture-key" });
  assert.equal(reply.text, "review complete");
  assert.deepEqual(reply.usage, { input: 18, output: 4, total: 29, reasoning: 7 });
  assert.equal(requests[1].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent");
  assert.equal(requests[1].options.headers["x-goog-api-key"], "fixture-key");
  assert.equal(requests[1].options.redirect, "error");
});

test("Ollama lists local models and unloads the selected model in low memory mode", async () => {
  const client = teamProvidersClient({ fetcher: async (url, options) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:11434\//);
    if (url.endsWith("/tags")) return Response.json({ models: [{ name: "local:latest" }, { name: "remote:cloud" }, { name: "proxy", remote_host: "example.invalid" }] });
    const body = JSON.parse(options.body);
    assert.equal(body.model, "local:latest");
    assert.equal(body.keep_alive, 0);
    assert.equal(body.messages[0].content, "task");
    return Response.json({ message: { content: "Local report" }, prompt_eval_count: 8, eval_count: 2 });
  } });
  assert.deepEqual(await client.list("ollama"), [{ value: "local:latest", label: "local:latest" }]);
  assert.equal((await client.run("ollama", { model: "local:latest", prompt: "task", lowMemory: true })).text, "Local report");
});

test("supplemental providers reject incomplete reports and surface usage limits separately", async () => {
  const gemini = teamProvidersClient({ fetcher: async () => Response.json({ candidates: [
    { finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } },
  ] }) });
  await assert.rejects(gemini.run("gemini", { key: "fixture", model: "gemini-flash" }), { status: "failed", message: /usable report/ });
  const ollama = teamProvidersClient({ fetcher: async () => Response.json({ message: { content: "partial" }, done: true, done_reason: "length" }) });
  await assert.rejects(ollama.run("ollama", { model: "local" }), { status: "failed" });
  const limited = teamProvidersClient({ fetcher: async () => new Response("raw credential", { status: 429 }) });
  await assert.rejects(limited.run("gemini", { key: "fixture", model: "gemini-flash" }), { status: "limited", message: /Gemini reached its usage limit/ });
});
