const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { runNotice, shouldNotify, notificationTarget, runToast } = require("../desktop/notifications.cjs");

test("completion notice distinguishes a finished reply from pending review, usage limits and failed checks", () => {
  const run = { finishedAt: new Date().toISOString(), agents: { codex: { status: "completed", answer: "Done" } } };
  assert.equal(runNotice(run).title, "Answer ready");
  const limited = { ...run, agents: { ...run.agents, claude: { status: "limited" } } };
  assert.deepEqual(runNotice(limited), {
    title: "Partial answer ready", detail: "Claude Code · Usage limit reached", needsInput: false,
  });
  assert.equal(runNotice({ ...limited, reviewPending: true }).title, "Task review pending");
  assert.equal(runNotice({ ...run, collaboration: { verdict: "partial" } }).title, "Partial answer ready");
  assert.equal(runNotice({ ...run, autoTeam: { status: "checks-failed" } }).title, "Task checks need attention");
  assert.equal(runNotice({ ...run, teamPlan: { state: "ready" } }).needsInput, true);
  assert.equal(runNotice({ ...run, finishedAt: undefined }), undefined);
  assert.equal(runNotice({ ...run, agents: { codex: { status: "interrupted" } } }), undefined);
});

test("background and approval preferences respect foreground visibility", () => {
  assert.equal(shouldNotify({ notifications: "always" }, true), true);
  assert.equal(shouldNotify({ notifications: "background" }, true), false);
  assert.equal(shouldNotify({ notifications: "background" }, false), true);
  const attention = { notifications: "off", attentionNotifications: true };
  assert.equal(shouldNotify(attention, false), false);
  assert.equal(shouldNotify(attention, false, true), true);
  assert.equal(shouldNotify(attention, true, true), false);
});

test("Windows toast escapes task titles and carries only validated IDs for navigation", () => {
  const target = { taskId: randomUUID(), runId: randomUUID() };
  const icon = "file:///C:/AI%20Deck/Icons%20%26%20Assets/notification-icon.png";
  const xml = runToast("Answer ready", "<ทีม> & Codex\u0000", target, icon);
  assert.ok(xml.includes(`<image placement="appLogoOverride" src="${icon}"/>`));
  assert.ok(runToast("AI Deck", "Test notification", undefined, icon).startsWith("<toast>"));
  assert.match(xml, /&lt;ทีม&gt; &amp; Codex<\/text>/u);
  const launch = xml.match(/launch="([^"]+)"/u)[1];
  assert.deepEqual(notificationTarget({ type: "click", arguments: launch }), target);
  assert.equal(notificationTarget({ type: "reply", arguments: launch }), undefined);
  assert.equal(notificationTarget({ type: "click", arguments: launch + "?repo=C:/some/path" }), undefined);
  assert.equal(runToast("Answer ready", "Task", { ...target, runId: '"/>' }), undefined);
});
