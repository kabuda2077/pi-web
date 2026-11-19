import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SIZE, MIN_SIZE, boundsToRemember, restoreBounds } from "../src/window-state.mjs";

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

test("a first launch gets the default size and lets the OS place the window", () => {
  assert.deepEqual(restoreBounds(undefined, [PRIMARY]), { ...DEFAULT_SIZE, maximized: false });
  assert.deepEqual(restoreBounds({ width: "wide" }, [PRIMARY]), { ...DEFAULT_SIZE, maximized: false });
});

test("saved bounds on a connected display are restored as they were", () => {
  const saved = { x: 200, y: 100, width: 1400, height: 900, maximized: false };
  assert.deepEqual(restoreBounds(saved, [PRIMARY]), saved);
  const onSecond = { x: 2400, y: 150, width: 1600, height: 1000, maximized: true };
  assert.deepEqual(restoreBounds(onSecond, [PRIMARY, SECOND]), onSecond);
});

test("a window saved on a display that is gone keeps its size but not its place", () => {
  const onSecond = { x: 2400, y: 150, width: 1600, height: 1000, maximized: false };
  assert.deepEqual(restoreBounds(onSecond, [PRIMARY]), { width: 1600, height: 1000, maximized: false });
});

test("a window whose title bar would be off screen is placed again", () => {
  // Above the top edge: nothing left to drag it back by.
  assert.equal(restoreBounds({ x: 100, y: -200, width: 1200, height: 800 }, [PRIMARY]).x, undefined);
  // Only a sliver on the right edge.
  assert.equal(restoreBounds({ x: 1900, y: 100, width: 1200, height: 800 }, [PRIMARY]).x, undefined);
  // Hanging off the left edge with enough still showing.
  assert.equal(restoreBounds({ x: -600, y: 100, width: 1200, height: 800 }, [PRIMARY]).x, -600);
});

test("the size stays between the minimum and the largest display", () => {
  const tiny = restoreBounds({ x: 10, y: 10, width: 50, height: 50 }, [PRIMARY]);
  assert.deepEqual([tiny.width, tiny.height], [MIN_SIZE.width, MIN_SIZE.height]);
  const huge = restoreBounds({ x: 0, y: 0, width: 5000, height: 4000 }, [PRIMARY]);
  assert.deepEqual([huge.width, huge.height], [PRIMARY.width, PRIMARY.height]);
});

test("without any display the default size is still returned", () => {
  assert.deepEqual(restoreBounds(undefined, []), { ...DEFAULT_SIZE, maximized: false });
});

// What Electron 45 reports at 150% scaling for a window created with the given bounds (measured).
const CREATED_WITH = { x: 213, y: 79, width: 1281, height: 861 };
const REPORTED = { x: 213, y: 79, width: 1284, height: 864 };

test("a window nobody moved keeps the bounds it was created with", () => {
  assert.deepEqual(boundsToRemember(REPORTED, REPORTED, CREATED_WITH), CREATED_WITH);
});

test("restoring and remembering again and again does not grow the window", () => {
  let remembered = CREATED_WITH;
  for (let launch = 0; launch < 5; launch += 1) {
    const restored = restoreBounds(remembered, [PRIMARY]);
    // Electron reports 3 more in each direction than it was given.
    const reported = { ...restored, width: restored.width + 3, height: restored.height + 3 };
    remembered = boundsToRemember(reported, reported, restored);
  }
  assert.deepEqual(remembered, CREATED_WITH);
});

test("a window that was moved or resized is remembered as it reports itself", () => {
  const moved = { ...REPORTED, x: 300 };
  assert.deepEqual(boundsToRemember(moved, REPORTED, CREATED_WITH), moved);
  const resized = { ...REPORTED, width: 1500 };
  assert.deepEqual(boundsToRemember(resized, REPORTED, CREATED_WITH), resized);
});

test("a window the OS placed is remembered where it landed", () => {
  const landed = { x: 213, y: 79, width: 1281, height: 861 };
  assert.deepEqual(boundsToRemember(landed, landed, { ...DEFAULT_SIZE }), landed);
});

test("only the bounds are remembered, whatever else the window reports", () => {
  assert.deepEqual(Object.keys(boundsToRemember({ ...REPORTED, extra: 1 }, CREATED_WITH, CREATED_WITH)), ["x", "y", "width", "height"]);
});
