import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { categorizeTasks } = await createJiti(import.meta.url).import("./task-groups.ts");

function session(id, day = 1, relation) {
  const date = `2026-03-${String(day).padStart(2, "0")}T00:00:00Z`;
  return { id, created: date, modified: date, cwd: "/fixture", path: `/fixture/${id}.jsonl`, messageCount: 1, firstMessage: id, relation };
}
const activity = { runningSessionIds: new Set(["waiting", "busy"]), awaitingInputSessionIds: new Set(["waiting"]), subagentsActiveSessionIds: new Set(["parent"]) };
const ids = rows => rows.map(row => row.id);

test("waiting wins over running; every ID occurs once, newest first", () => {
  const rows = Object.freeze([session("parent"), session("waiting"), session("old"), session("new", 4), session("busy", 2), session("old", 3)]);
  const groups = categorizeTasks(rows, activity);
  assert.deepEqual(ids(groups.waiting), ["waiting"]);
  assert.deepEqual(ids(groups.running), ["busy", "parent"]);
  assert.deepEqual(ids(groups.recent), ["new", "old"]);
  assert.equal(groups.recent[1], rows[5]);
});

test("subagent metadata describes rows but never promotes them outside the sidebar's live sets", () => {
  const statuses = ["starting", "queued", "running", "completed", "failed", "aborted", "interrupted"];
  const rows = statuses.map((status, index) => session(status, index + 1, { kind: "subagent", parentSessionId: "parent", status, profile: "test", description: status }));
  const groups = categorizeTasks(rows, { ...activity, awaitingInputSessionIds: new Set(["starting"]), runningSessionIds: new Set(["starting", "queued"]) });
  assert.deepEqual(ids(groups.waiting), ["starting"]);
  assert.deepEqual(ids(groups.running), ["queued"]);
  assert.deepEqual(ids(groups.recent), ["interrupted", "aborted", "failed", "completed", "running"]);
});

test("only Recent is capped, after sorting all sessions across projects", () => {
  const rows = Array.from({ length: 25 }, (_, i) => session(`r${i}`, i + 1));
  const busy = rows.map(row => ({ ...row, id: `busy-${row.id}` }));
  const groups = categorizeTasks([...rows, ...busy], { ...activity, runningSessionIds: new Set(ids(busy)) });
  assert.deepEqual(ids(groups.recent), ids(rows).reverse().slice(0, 20));
  assert.equal(groups.running.length, 25);
  assert.deepEqual(categorizeTasks([], activity), { waiting: [], running: [], recent: [] });
});
