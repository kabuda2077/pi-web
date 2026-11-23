import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { renderHook } from "./__fixtures__/react-hook-shim.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const hooks = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url)) } });
const { useNewProjectFolder } = await hooks.import("./useNewProjectFolder.ts");
const { POST: mkdirRoute } = await jiti.import("../app/api/cwd/browse/route.ts");
const { applySessionUiStateRequest, parseSessionUiStateRequest, normalizeSessionUiState, emptySessionUiState } = await jiti.import("../lib/session-ui-state-shared.ts");
const { buildSessionTree } = await jiti.import("../lib/session-tree.ts");

async function fixture(t, { failValidationOnce = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-new-project-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [], opened = [], cancelled = [];
  let ui = emptySessionUiState();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push(url);
    if (url === "/api/cwd/browse") return mkdirRoute(new Request(`http://localhost${url}`, { ...init, headers: { ...init.headers, host: "localhost" } }));
    assert.equal(url, "/api/cwd/validate");
    if (failValidationOnce) { failValidationOnce = false; return Response.json({}, { status: 503 }); }
    const cwd = await realpath(JSON.parse(init.body).cwd);
    return Response.json({ cwd, projectRoot: cwd, projectKey: "new-project-key" });
  });
  const hook = renderHook(() => useNewProjectFolder(async ({ projectKey, projectRoot }) => {
    const parsed = parseSessionUiStateRequest({ action: "register-project", projectKey, root: projectRoot });
    assert.ok(parsed.ok);
    ui = applySessionUiStateRequest(ui, parsed.request, Date.now()).state;
    return true;
  }, (folder) => opened.push(folder), () => cancelled.push(true)));
  t.after(() => hook.unmount());
  hook.result.setParent(root);
  hook.result.setName("  Project One  ");
  hook.flush();
  return { root, hook, requests, opened, cancelled, readState: () => normalizeSessionUiState(JSON.parse(JSON.stringify(ui))) };
}

test("creates one physical child and keeps its unpinned group after leaving the empty draft", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.hook.result.submit(), f.hook.result.submit()]);
  const cwd = await realpath(path.join(f.root, "Project One"));
  assert.deepEqual(await readdir(cwd), []);
  assert.deepEqual(f.requests, ["/api/cwd/browse", "/api/cwd/validate"]);
  assert.deepEqual(f.opened, [{ cwd, projectRoot: cwd, projectKey: "new-project-key" }]);
  const model = buildSessionTree({ sessions: [], uiState: f.readState(), currentProject: null, groupExpansion: {}, moreShown: {}, runningIds: new Set(), unreadIds: new Set() });
  assert.equal(model.projects[0].root, cwd);
  assert.equal(model.projects[0].pinned, false);
  assert.equal(model.projects[0].registered, true);
});

test("cancellation writes nothing; an invalid name cannot create a sibling", async (t) => {
  const f = await fixture(t);
  f.hook.result.setName("../sibling"); f.hook.flush();
  await f.hook.result.submit(); f.hook.flush();
  assert.equal(f.hook.result.error, "newProject.invalidName");
  f.hook.result.setName("another"); f.hook.flush();
  f.hook.result.cancel();
  assert.deepEqual(f.cancelled, [true]);
  await f.hook.result.submit();
  assert.deepEqual(f.requests, []);
  assert.deepEqual(await readdir(f.root), []);
});

test("an existing folder is not opened or overwritten", async (t) => {
  const f = await fixture(t);
  const existing = path.join(f.root, "Project One");
  await mkdir(existing);
  await writeFile(path.join(existing, "keep"), "original");
  await f.hook.result.submit(); f.hook.flush();
  assert.equal(f.hook.result.error, "newProject.exists");
  assert.deepEqual(f.requests, ["/api/cwd/browse"]);
  assert.deepEqual(f.opened, []);
  assert.equal(await readFile(path.join(existing, "keep"), "utf8"), "original");
});

test("a failed open retries validation, not creation", async (t) => {
  const f = await fixture(t, { failValidationOnce: true });
  await f.hook.result.submit(); f.hook.flush();
  assert.equal(f.hook.result.error, "newProject.openFailed");
  assert.deepEqual(f.opened, []);
  await f.hook.result.submit();
  assert.deepEqual(f.requests, ["/api/cwd/browse", "/api/cwd/validate", "/api/cwd/validate"]);
  assert.equal(f.opened.length, 1);
});
