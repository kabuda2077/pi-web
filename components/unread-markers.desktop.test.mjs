import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

// The desktop fork's fix of the sidebar's unread markers: pi-web's two updates
// of them could start each other over and over on some page loads
// (desktop/README.md, "Unread markers").
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

function between(startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(start, -1, `${startAnchor} not found`);
  assert.notEqual(end, -1, `${endAnchor} not found after ${startAnchor}`);
  return source.slice(start, end);
}

test("activity changes preserve unchanged unread state and shared reads settle without another dispatch", async () => {
  const { sameMarksOr, unreadIdsOf, withoutReadMarks } = await jiti.import("@/lib/unread-markers.ts");
  const activity = between("      setUnreadMarks((prev) => {\n        const next = new Map(prev);\n        runningSessionIds", "\n    }");
  const cleanup = between("const unreadSessionIds = useMemo(", "\n\n  // What the read triggers");
  let marks = new Map();
  let writes = 0;
  const context = { Map, sameMarksOr, withoutReadMarks, runningSessionIds: new Set(["active"]),
    completedWithNotifications: [], markedAt: 20, useEffect: (fn) => fn(),
    setUnreadMarks: (fn) => { writes++; marks = fn(marks); } };
  const reconcile = (readAt) => vm.runInNewContext(cleanup, { ...context, readAt, unreadMarks: marks, unreadIdsOf, useMemo: (fn) => fn() });
  const empty = marks;
  vm.runInNewContext(activity, context);
  assert.equal(marks, empty, "a transition that changes no marker keeps the Map it had");
  reconcile({});
  assert.equal(writes, 1, "no cleanup dispatch for an empty map");
  marks = new Map([["active", 10]]);
  context.completedWithNotifications = ["finished"];
  vm.runInNewContext(activity, context);
  assert.deepEqual([...marks], [["finished", 20]]);
  reconcile({ finished: 19 });
  assert.equal(writes, 2, "a stale read leaves the new completion alone");
  reconcile({ finished: 20 });
  assert.equal(marks.size, 0);
  reconcile({ finished: 20 });
  assert.equal(writes, 3, "a covered mark is cleared just once");
});
