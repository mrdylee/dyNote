export const defaultFonts = Object.freeze({ uiFamily: "", bodyFamily: "", codeFamily: "", uiSize: 13, bodySize: 15, codeSize: 12, lineHeight: 1.85 });
const bounds = { uiSize: [11, 20], bodySize: [12, 32], codeSize: [10, 24], lineHeight: [1.2, 2.5] };
const system = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif';
const mono = '"SFMono-Regular", Consolas, "Apple SD Gothic Neo", monospace';

export function normalizeFonts(input) {
  const result = { ...defaultFonts };
  for (const key of ["uiFamily", "bodyFamily", "codeFamily"]) {
    const value = input?.[key];
    if (typeof value === "string" && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value)) result[key] = value;
  }
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = input?.[key];
    if (Number.isFinite(value) && value >= min && value <= max) result[key] = value;
  }
  return result;
}

export function fontVariables(preferences) {
  const p = normalizeFonts(preferences);
  const family = (name, fallback) => name ? `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}", ${fallback}` : fallback;
  return {
    "--ui-font": family(p.uiFamily, system), "--body-font": family(p.bodyFamily, system), "--code-font": family(p.codeFamily, mono),
    "--ui-size": `${p.uiSize}px`, "--body-size": `${p.bodySize}px`, "--code-size": `${p.codeSize}px`, "--body-line-height": String(p.lineHeight),
  };
}
