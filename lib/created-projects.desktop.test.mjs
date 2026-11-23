import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Projects + of the desktop fork: a folder made there is a project from then
// on, before it has a session and without a pin. It is recorded in the
// sidebar's shared state file as `createdProjects`.
const jiti = createJiti(import.meta.url);
const { readSessionUiState, resetSessionUiStateCacheForTests, updateSessionUiState } = await jiti.import("./session-ui-state.ts");
const { MAX_PROJECT_NAMES, applySessionUiStateRequest, normalizeSessionUiState, parseSessionUiStateRequest } = await jiti.import("./session-ui-state-shared.ts");

function fixture(t) {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = fs.mkdtempSync(join(tmpdir(), "pi-web-created-projects-"));
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  resetSessionUiStateCacheForTests();
  t.after(() => {
    resetSessionUiStateCacheForTests();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { path: join(root, "agent", "pi-web-session-state.json") };
}

const empty = () => ({ version: 1, revision: 0, sessions: {}, projects: {} });

test("a registered project survives a restart without a pin or session", async (t) => {
  const { path } = fixture(t);
  const register = { action: "register-project", projectKey: "new", root: "/New Project" };
  const first = await updateSessionUiState(register, path);
  resetSessionUiStateCacheForTests();
  const restored = readSessionUiState(path);
  assert.deepEqual(restored.createdProjects, { new: "/New Project" });
  assert.deepEqual(restored.projects, {});
  assert.deepEqual(restored.sessions, {});
  assert.equal((await updateSessionUiState(register, path)).revision, first.revision, "registering it again changes nothing");
  // The other actions leave the record alone.
  const pinned = await updateSessionUiState({ action: "pin-project", projectKey: "other", root: "/Other", pinned: true }, path);
  assert.deepEqual(pinned.createdProjects, { new: "/New Project" });
  assert.deepEqual(JSON.parse(fs.readFileSync(path, "utf8")).createdProjects, { new: "/New Project" });
});

test("register-project is parsed as pin-project is, and a state without the record reads as before", () => {
  assert.deepEqual(parseSessionUiStateRequest({ action: "register-project", projectKey: "k", root: "/r", pinned: "ignored" }),
    { ok: true, request: { action: "register-project", projectKey: "k", root: "/r" } });
  for (const body of [{ action: "register-project", root: "/r" }, { action: "register-project", projectKey: "", root: "/r" }, { action: "register-project", projectKey: "k" }, { action: "register-project", projectKey: "k", root: 3 }]) {
    assert.equal(parseSessionUiStateRequest(body).ok, false, JSON.stringify(body));
  }
  assert.equal("createdProjects" in normalizeSessionUiState(empty()), false);
  assert.deepEqual(normalizeSessionUiState({ ...empty(), createdProjects: { ok: "/ok", bad: 3, "": "/empty" } }).createdProjects, { ok: "/ok" });
  assert.equal("createdProjects" in normalizeSessionUiState({ ...empty(), createdProjects: ["/list"] }), false);
});

test("the record has the room of the project names, and a project that does not fit is not stored", () => {
  let state = empty();
  for (let index = 0; index < MAX_PROJECT_NAMES; index++) {
    const applied = applySessionUiStateRequest(state, { action: "register-project", projectKey: `k${index}`, root: `/r${index}` }, 1);
    assert.equal(applied.changed, true, String(index));
    state = applied.state;
  }
  assert.equal(Object.keys(state.createdProjects).length, MAX_PROJECT_NAMES);
  const refused = applySessionUiStateRequest(state, { action: "register-project", projectKey: "one-more", root: "/one-more" }, 1);
  assert.equal(refused.changed, false);
  assert.equal(Object.hasOwn(refused.state.createdProjects, "one-more"), false, "the route answers 409 for this");
  const again = applySessionUiStateRequest(state, { action: "register-project", projectKey: "k0", root: "/r0" }, 1);
  assert.equal(again.changed, false);
});
