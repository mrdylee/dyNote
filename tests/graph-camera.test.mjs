import test from "node:test";
import assert from "node:assert/strict";
import { worldToScreen, screenToWorld, zoomAt, segmentVisible } from "../core/graph-camera.mjs";
test("camera conversion round trips and zoom preserves cursor world point", () => {
  const c = { x: 110, y: -20, zoom: 0.4 }, p = { x: -123, y: 456 };
  const screen = worldToScreen(p, c), back = screenToWorld(screen, c);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
  const next = zoomAt(c, screen, 2);
  const fixed = worldToScreen(p, next);
  assert.ok(Math.abs(fixed.x - screen.x) < 1e-9 && Math.abs(fixed.y - screen.y) < 1e-9);
});
test("edges crossing the viewport survive even with both ends outside", () => {
  assert.equal(segmentVisible(-20, 50, 120, 50, 100, 100), true);
  assert.equal(segmentVisible(-20, -20, -10, 120, 100, 100), false);
  assert.equal(segmentVisible(-20, 120, 120, -20, 100, 100), true);
});
