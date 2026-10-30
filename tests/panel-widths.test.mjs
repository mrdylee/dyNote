import test from "node:test";
import assert from "node:assert/strict";
import { normalizePanelWidths, fitPanelWidths } from "../core/panel-widths.mjs";
test("panel preferences reject malformed saved widths", () => {
  assert.deepEqual(normalizePanelWidths(null), {left:244,right:340});
  assert.deepEqual(normalizePanelWidths({left:-2,right:"400"}), {left:244,right:340});
  assert.deepEqual(normalizePanelWidths({left:1e9,right:Infinity}), {left:480,right:340});
  assert.deepEqual(normalizePanelWidths({left:300,right:450}), {left:300,right:450});
});
test("wide panels fit a narrow window with center space reserved", () => {
  const fit=fitPanelWidths({left:480,right:600},1000,true);
  assert.ok(fit.left>=180 && fit.right>=240);
  assert.ok(fit.left+fit.right+64+10+360<=1000);
  assert.deepEqual(fitPanelWidths({left:300,right:420},1500,true),{left:300,right:420});
  assert.equal(fitPanelWidths({left:480,right:600},1000,false).left,480);
});
