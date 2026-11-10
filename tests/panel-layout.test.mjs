import assert from "node:assert/strict";
import test from "node:test";
import { defaultPanelWidths, normalizePanelWidths, panelLayout } from "../desktop/panel-layout.mjs";

const both = { projects: true, inspector: true };
const size = (width, options = {}) => panelLayout({
  width, panels: both, priority: "projects", widths: defaultPanelWidths, ...options,
});

test("both dividers respect the reserved chat width without discarding preferred panel sizes", () => {
  const widths = { projects: 480, inspector: 560 };
  const tight = size(1240, { widths });
  const total = tight.projects.width + tight.inspector.width;
  assert.equal(1240 - 40 - 16 - total, 540);
  assert.equal(tight.projects.max, tight.projects.width);
  assert.equal(tight.inspector.max, tight.inspector.width);
  const wide = size(1920, { widths });
  assert.equal(wide.projects.width, widths.projects);
  assert.equal(wide.inspector.width, widths.inspector);
  assert.equal(wide.focused, null);
});

test("medium windows dock the last requested panel and narrow windows keep chat until a panel is opened", () => {
  const medium = size(1010, { priority: "inspector" });
  assert.equal(medium.inspector.width, 320);
  assert.equal(medium.projects, undefined);
  assert.equal(medium.focused, null);
  const narrow = size(600);
  assert.equal(narrow.columns, "40px minmax(0, 1fr)");
  assert.equal(narrow.focused, null);
  const focused = size(600, { standalone: "projects" });
  assert.equal(focused.focused, "projects");
  assert.equal(focused.projects, undefined);
  assert.equal(focused.inspector, undefined);
  assert.equal(size(1920, { standalone: "projects" }).focused, null);
});

test("split and larger text reserve more room while restoring older panel settings safely", () => {
  const options = { priority: "inspector", textScale: 130, split: true };
  assert.ok(size(1240).inspector);
  assert.equal(size(1240, options).projects, undefined);
  assert.equal(size(760, { ...options, standalone: "inspector" }).focused, "inspector");
  assert.deepEqual(normalizePanelWidths({ projects: "480", inspector: 10000 }), { projects: 224, inspector: 560 });
});