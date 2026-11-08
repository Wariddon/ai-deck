const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeAppearance } = require("../desktop/appearance.mjs");

test("existing profiles and invalid display preferences use compact defaults", () => {
  assert.deepEqual(normalizeAppearance(undefined), { uiScale: 100, textScale: 100 });
  assert.deepEqual(normalizeAppearance({ uiScale: 85, textScale: 999 }), { uiScale: 85, textScale: 100 });
  assert.deepEqual(normalizeAppearance({ uiScale: "80", textScale: 125 }), { uiScale: 100, textScale: 125 });
});
