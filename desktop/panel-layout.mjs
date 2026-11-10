const panelSizes = {
  projects: { min: 176, max: 480, initial: 224 },
  inspector: { min: 258, max: 560, initial: 320 },
};
const navWidth = 40;
const dividerWidth = 8;
const clamp = (width, min, max) => Math.max(min, Math.min(max, width));

export function normalizePanelWidths(widths) {
  return Object.fromEntries(Object.entries(panelSizes).map(([side, { min, max, initial }]) => [
    side, Number.isFinite(widths?.[side]) ? clamp(Math.round(widths[side]), min, max) : initial,
  ]));
}

export const defaultPanelWidths = Object.freeze(normalizePanelWidths());

export function panelLayout({ width, textScale = 100, split = false, panels, priority, standalone, widths }) {
  const chatMinimum = Math.ceil((split ? 640 : 540) * Math.max(1, textScale / 100));
  const budget = width - navWidth - chatMinimum;
  const order = priority === "inspector" ? ["inspector", "projects"] : ["projects", "inspector"];
  const docked = {};
  const focused = panels[standalone] && budget < panelSizes[standalone].min + dividerWidth ? standalone : null;
  const desired = normalizePanelWidths(widths);
  let space = budget;
  const visible = focused ? [] : order.filter((side) => {
    const minimum = panelSizes[side].min + dividerWidth;
    if (!panels[side] || space < minimum) return false;
    space -= minimum;
    return true;
  });

  for (const side of visible) {
    const { min, max } = panelSizes[side];
    const extra = Math.min(space, desired[side] - min);
    docked[side] = { width: min + extra, min, max };
    space -= extra;
  }
  for (const panel of Object.values(docked)) panel.max = Math.min(panel.max, panel.width + space);

  const columns = [navWidth + "px"];
  if (docked.projects) columns.push("var(--projects-width)", dividerWidth + "px");
  columns.push("minmax(0, 1fr)");
  if (docked.inspector) columns.push(dividerWidth + "px", "var(--inspector-width)");
  return { ...docked, focused, columns: columns.join(" ") };
}