export const defaultPanelWidths = Object.freeze({ left: 244, right: 340 });
export const panelBounds = Object.freeze({ left: [180, 480], right: [240, 600] });
export function normalizePanelWidths(input) {
  return Object.fromEntries(Object.entries(panelBounds).map(([side, [min, max]]) => [side,
    Number.isFinite(input?.[side]) && input[side] > 0 ? Math.round(Math.max(min, Math.min(max, input[side]))) : defaultPanelWidths[side],
  ]));
}
export function fitPanelWidths(input, viewport, rightVisible) {
  const widths = normalizePanelWidths(input);
  const budget = Math.max(1000, viewport) - 64 - 360 - (rightVisible ? 10 : 5);
  if (!rightVisible) return { ...widths, left: Math.min(widths.left, budget) };
  const excess = Math.max(0, widths.left + widths.right - budget);
  widths.right = Math.max(panelBounds.right[0], widths.right - excess);
  widths.left = Math.min(widths.left, budget - widths.right);
  return widths;
}
