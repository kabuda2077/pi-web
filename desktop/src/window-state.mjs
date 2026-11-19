export const DEFAULT_SIZE = { width: 1280, height: 860 };
export const MIN_SIZE = { width: 480, height: 360 };

/** How much of the window must sit on a display for it to count as reachable. */
const MIN_VISIBLE = 120;
const BOUNDS_KEYS = ["x", "y", "width", "height"];

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The bounds to open a window with: the saved ones while they still land on a
 * connected display, otherwise only a size, which the OS places. A display
 * unplugged since the last run must not leave the window off screen.
 *
 * @param saved What was remembered last time, with `maximized`
 * @param workAreas Each connected display's work area
 */
export function restoreBounds(saved, workAreas) {
  const largest = workAreas.reduce(
    (best, area) => (area.width * area.height > best.width * best.height ? area : best),
    workAreas[0] ?? { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height },
  );
  const clamp = (value, min, max) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
  const width = clamp(isNumber(saved?.width) ? saved.width : DEFAULT_SIZE.width, MIN_SIZE.width, largest.width);
  const height = clamp(isNumber(saved?.height) ? saved.height : DEFAULT_SIZE.height, MIN_SIZE.height, largest.height);
  const maximized = saved?.maximized === true;

  if (!isNumber(saved?.x) || !isNumber(saved?.y)) return { width, height, maximized };

  const reachable = workAreas.some((area) => {
    const overlapX = Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x);
    // The title bar is what gets dragged, so the top edge must be on the display.
    const topOnDisplay = saved.y >= area.y - 8 && saved.y <= area.y + area.height - MIN_VISIBLE;
    return overlapX >= MIN_VISIBLE && topOnDisplay;
  });

  return reachable
    ? { x: Math.round(saved.x), y: Math.round(saved.y), width, height, maximized }
    : { width, height, maximized };
}

/**
 * The bounds to remember for a window that reports `now`.
 *
 * On a scaled display Electron reports a window a few pixels larger than the
 * bounds it was created with (at 150%, 1280 wide comes back as 1284), so
 * restoring from what a window reports would grow it with every launch. A
 * window that still reports what it did when it was created has not been moved
 * or resized, and keeps the bounds it was created with.
 *
 * @param now What the window reports
 * @param created What it reported when it was created
 * @param restored The bounds it was created with, from `restoreBounds()`
 */
export function boundsToRemember(now, created, restored) {
  const unchanged = BOUNDS_KEYS.every((key) => now[key] === created[key]);
  // A window the OS placed has no position to keep yet: where it landed is remembered.
  const source = unchanged && isNumber(restored.x) ? restored : now;
  return Object.fromEntries(BOUNDS_KEYS.map((key) => [key, source[key]]));
}
