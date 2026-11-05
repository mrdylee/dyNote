import test from "node:test";
import assert from "node:assert/strict";
import { fitStickyBounds, nextStickyPlacement, STICKY_COLORS } from "../core/sticky-layout.mjs";

const workArea = { x: -1200, y: 28, width: 1200, height: 800 };
const position = ({ x, y }) => [x, y];

test("new stickies use distinct colors and positions on the current display", () => {
  const cards = [];
  for (let index = 0; index < STICKY_COLORS.length; index++) {
    cards.push(nextStickyPlacement(workArea, cards, cards.at(-1)));
  }
  assert.equal(new Set(cards.map(card => card.color)).size, cards.length);
  assert.equal(new Set(cards.map(card => String(position(card.bounds)))).size, cards.length);
  assert.ok(cards[0].bounds.x > cards[1].bounds.x);
  for (const { bounds } of cards) assert.deepEqual(fitStickyBounds(bounds, workArea), bounds);
});

test("a new card varies its color and position after the previous card closes", () => {
  const previous = nextStickyPlacement(workArea, []);
  const next = nextStickyPlacement(workArea, [], previous);
  assert.notEqual(next.color, previous.color);
  assert.notDeepEqual(position(next.bounds), position(previous.bounds));
});

test("on a crowded display the next card leaves the previous header accessible", () => {
  const area = { x: 0, y: 30, width: 540, height: 300 };
  const first = nextStickyPlacement(area, []);
  const second = nextStickyPlacement(area, [first], first);
  assert.ok(second.bounds.y >= first.bounds.y + 30);
  assert.deepEqual(fitStickyBounds(second.bounds, area), second.bounds);
});

test("restoring a card on a different display moves it into view", () => {
  const bounds = { x: -840, y: 900, width: 320, height: 220 };
  const area = { x: 0, y: 24, width: 900, height: 640 };
  assert.deepEqual(fitStickyBounds(bounds, area), { x: 0, y: 444, width: 320, height: 220 });
});
