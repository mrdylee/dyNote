import test from "node:test";
import assert from "node:assert/strict";
import { normalizePanelWidths, fitPanelWidths } from "../core/panel-widths.mjs";
test("panel preferences reject malformed saved widths", () => {
  assert.deepEqual(normalizePanelWidths(null), {left:244,right:340});
  assert.deepEqual(normalizePanelWidths({left:-2,right:"400"}), {left:244,right:340});
  assert.deepEqual(normalizePanelWidths({left:NaN,right:Infinity}), {left:244,right:340});
  assert.deepEqual(normalizePanelWidths({left:800,right:760}), {left:800,right:760});
});
test("wide panels fit a narrow window with center space reserved", () => {
  const wide={left:800,right:760};
  assert.deepEqual(fitPanelWidths(wide,1920,true),wide);
  assert.deepEqual(fitPanelWidths(wide,1000,true),{left:406,right:240});
  assert.deepEqual(fitPanelWidths({left:300,right:420},1500,true),{left:300,right:420});
  assert.deepEqual(fitPanelWidths(wide,1000,false),{left:651,right:760});
});
