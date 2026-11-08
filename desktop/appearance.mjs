export const defaultAppearance = Object.freeze({ uiScale: 100, textScale: 100 });

export const appearanceOptions = {
  uiScale: [80, 85, 90, 95, 100, 105, 110, 115, 120, 125],
  textScale: [90, 95, 100, 105, 110, 115, 120, 125, 130],
};

export function normalizeAppearance(appearance) {
  return {
    uiScale: appearanceOptions.uiScale.includes(appearance?.uiScale) ? appearance.uiScale : defaultAppearance.uiScale,
    textScale: appearanceOptions.textScale.includes(appearance?.textScale) ? appearance.textScale : defaultAppearance.textScale,
  };
}
