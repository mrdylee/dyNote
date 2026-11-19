export const defaultPanelWidths = Object.freeze({ left: 244, right: 340 });
export const minimumPanelWidths = Object.freeze({ left: 180, right: 240 });
export function normalizePanelWidths(input) {
  return Object.fromEntries(Object.entries(minimumPanelWidths).map(([side, min]) => [side,
    Number.isFinite(input?.[side]) && input[side] > 0 ? Math.round(Math.max(min, input[side])) : defaultPanelWidths[side],
  ]));
}

export function panelWidthBudget(viewport, rightVisible) {
  return Math.max(1000, viewport) - 64 - 280 - (rightVisible ? 10 : 5);
}

export function fitPanelWidths(input, viewport, rightVisible) {
  const widths = normalizePanelWidths(input);
  const budget = panelWidthBudget(viewport, rightVisible);
  const left = Math.min(widths.left, budget - (rightVisible ? minimumPanelWidths.right : 0));
  const right = rightVisible ? Math.min(widths.right, budget - left) : widths.right;
  return { left, right };
}
