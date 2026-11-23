import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const sandbox = mkdtempSync(join(tmpdir(), "pi-web-temp-chats-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
test.after(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(sandbox, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } });
const { GET, POST, PUT, DELETE } = await jiti.import("../app/api/temp-chats/route.ts");
const { invalidateSessionListCache } = await jiti.import("./session-reader.ts");
/** What a restart of the server does to the folders held for drafts. */
const restart = () => globalThis[Symbol.for("pi-web:temp-chats-held")]?.clear();

function fixture() {
  const dir = mkdtempSync(join(sandbox, "fixture-"));
  const agent = join(dir, "agent");
  process.env.PI_CODING_AGENT_DIR = agent;
  return { dir, agent, stateFile: join(agent, "pi-web-temp-chats.json") };
}
function request(method, body, headers) {
  return new Request("http://localhost/api/temp-chats", {
    method, headers: { host: "localhost", ...(body !== undefined && { "content-type": "application/json" }), ...headers }, body,
  });
}
const put = (root) => PUT(request("PUT", JSON.stringify({ root })));
const post = () => POST(request("POST"));
const release = (cwd, headers) => DELETE(new Request(`http://localhost/api/temp-chats?cwd=${encodeURIComponent(cwd)}`, { method: "DELETE", headers: { host: "localhost", ...headers } }));
const reserve = async () => (await success(await post())).cwd;

function homeFixture(t) {
  const home = mkdtempSync(join(sandbox, "home-"));
  const keys = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR"];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
  }));
  process.env.HOME = process.env.USERPROFILE = home;
  delete process.env.PI_CODING_AGENT_DIR;
  assert.equal(homedir(), home);
  return { home, stateFile: join(home, ".pi", "agent", "pi-web-temp-chats.json") };
}

async function success(response) {
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

test("a GET creates nothing; chats opened at once get registered folders of their own", async () => {
  const { agent, stateFile } = fixture();
  const empty = await success(await GET());
  assert.deepEqual(empty, { root: join(agent, "pi-web-chats"), cwds: [] });
  assert.equal(existsSync(agent), false);
  const responses = await Promise.all(Array.from({ length: 12 }, post));
  const cwds = await Promise.all(responses.map(async (res) => {
    const { cwd } = await success(res);
    assert.equal(dirname(cwd), realpathSync.native(empty.root));
    assert.deepEqual(readdirSync(cwd), []);
    return cwd;
  }));
  assert.equal(new Set(cwds).size, cwds.length);
  assert.deepEqual(new Set((await success(await GET())).cwds), new Set(cwds));
  if (process.platform !== "win32") assert.equal(statSync(stateFile).mode & 0o777, 0o600);
});

test("home default is lazy; a legacy default changes only future allocations", async t => {
  const { home, stateFile } = homeFixture(t);
  const root = join(home, "Chats");
  const legacy = join(home, "Pi Chats");
  assert.deepEqual(await success(await GET()), { root, cwds: [] });
  assert.deepEqual(readdirSync(home), []);

  const old = join(legacy, "chat-existing");
  const cwds = [old, join(home, "other", "chat-missing")];
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "keep.txt"), "original");
  mkdirSync(dirname(stateFile), { recursive: true });
  const contents = JSON.stringify({ root: legacy, cwds });
  writeFileSync(stateFile, contents);
  assert.deepEqual(await success(await GET()), { root, cwds });
  assert.equal(readFileSync(stateFile, "utf8"), contents);
  assert.equal(existsSync(root), false);

  const { cwd } = await success(await post());
  assert.equal(dirname(cwd), realpathSync.native(root));
  assert.deepEqual(await success(await GET()), { root, cwds: [...cwds, cwd] });
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).root, root);
  assert.equal(readFileSync(join(old, "keep.txt"), "utf8"), "original");
  assert.deepEqual(readdirSync(legacy), ["chat-existing"]);

  const selected = realpathSync.native(legacy);
  await success(await put(legacy));
  assert.equal((await success(await GET())).root, selected);
  assert.equal(dirname((await success(await post())).cwd), selected);
});

test("legacy custom roots are neither renamed nor recreated, even when named Chats", async t => {
  const { home, stateFile } = homeFixture(t);
  mkdirSync(dirname(stateFile), { recursive: true });
  for (const root of [join(home, "other", "Pi Chats"), join(home, "Chats")]) {
    const contents = JSON.stringify({ root, cwds: [] });
    writeFileSync(stateFile, contents);
    assert.deepEqual(await success(await GET()), { root, cwds: [] });
    assert.equal((await post()).status, 500);
    assert.equal(existsSync(root), false);
    assert.equal(readFileSync(stateFile, "utf8"), contents);
  }
});

test("changing the root retains previous cwds, never adopts neighboring folders, and does not move files", async () => {
  const { dir } = fixture();
  const { cwd: old } = await success(await post());
  writeFileSync(join(old, "keep.txt"), "still here");
  const next = join(dir, "selected");
  mkdirSync(join(next, "unrelated"), { recursive: true });
  const root = realpathSync.native(next);
  assert.deepEqual(await success(await put(next)), { root });
  assert.deepEqual(await success(await GET()), { root, cwds: [old] });
  const { cwd } = await success(await post());
  assert.equal(dirname(cwd), root);
  assert.deepEqual(await success(await GET()), { root, cwds: [old, cwd] });
  assert.equal(readFileSync(join(old, "keep.txt"), "utf8"), "still here");
  rmSync(next, { recursive: true });
  assert.equal((await post()).status, 500);
  assert.equal(existsSync(next), false);
  assert.deepEqual(await success(await GET()), { root, cwds: [old, cwd] });
});

test("rejects invalid roots and foreign writes before changing anything", async () => {
  const { dir, agent } = fixture();
  const file = join(dir, "file");
  writeFileSync(file, "not a directory");
  for (const root of [null, [], "", "relative", join(dir, "missing"), file, `${dir}\0`]) {
    assert.equal((await put(root)).status, 400);
  }
  assert.equal((await PUT(request("PUT", "{"))).status, 400);
  assert.equal((await PUT(request("PUT", "{}", { "content-type": "text/plain" }))).status, 415);
  const foreign = { origin: "https://example.org" };
  assert.equal((await PUT(request("PUT", JSON.stringify({ root: dir }), foreign))).status, 403);
  assert.equal((await POST(request("POST", undefined, foreign))).status, 403);
  assert.equal(existsSync(agent), false);
});

test("a reserved cwd accepts attachments before the first send without granting access to its root or siblings", async () => {
  const { dir } = fixture();
  const root = join(dir, "chats");
  const sibling = join(root, "existing");
  mkdirSync(sibling, { recursive: true });
  const { POST: uploadFile } = await jiti.import("../app/api/files/[...path]/route.ts");
  const { encodeFilePathForApi } = await jiti.import("./file-paths.ts");
  const { NextRequest } = await jiti.import("next/server");
  async function upload(directory) {
    const encoded = encodeFilePathForApi(directory);
    const form = new FormData();
    form.append("files", new File(["fixture"], "attachment.txt"));
    return uploadFile(new NextRequest(`http://localhost/api/files/${encoded}?type=upload&conflict=skip`, {
      method: "POST", headers: { host: "localhost" }, body: form,
    }), { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) });
  }
  await success(await put(root));
  assert.equal((await upload(root)).status, 403);
  const { cwd } = await success(await post());
  assert.deepEqual(await success(await upload(cwd)), { uploaded: ["attachment.txt"], skipped: [], errors: [] });
  assert.equal(readFileSync(join(cwd, "attachment.txt"), "utf8"), "fixture");
  assert.equal((await upload(root)).status, 403);
  assert.equal((await upload(sibling)).status, 403);
});

test("a malformed registry is not erased and no untracked chat is created", async () => {
  const { dir, agent, stateFile } = fixture();
  mkdirSync(agent);
  for (const invalid of ["{", JSON.stringify({ root: dir, cwds: [42] })]) {
    writeFileSync(stateFile, invalid);
    assert.equal((await GET()).status, 500);
    assert.equal((await post()).status, 500);
    assert.equal((await put(dir)).status, 500);
    assert.equal(readFileSync(stateFile, "utf8"), invalid);
    assert.deepEqual(readdirSync(agent), ["pi-web-temp-chats.json"]);
  }
});

test("a folder no chat started in goes to the next chat: after a release or a restart, never to two drafts at once", async () => {
  const { stateFile } = fixture();
  const first = await reserve();
  const second = await reserve();
  assert.notEqual(second, first, "a held folder is not handed out again");
  assert.deepEqual(JSON.parse(readFileSync(stateFile, "utf8")).cwds, [first, second]);

  // The page that held it went away.
  assert.deepEqual(await success(await release(first)), { released: true });
  assert.equal(await reserve(), first);
  assert.equal((await release(first, { origin: "https://example.org" })).status, 403);
  assert.notEqual(await reserve(), first, "a foreign page releases nothing");

  restart();
  const again = [await reserve(), await reserve(), await reserve()];
  const known = JSON.parse(readFileSync(stateFile, "utf8")).cwds;
  assert.equal(known.length, 3, "every unused folder is taken before a new one is made");
  assert.deepEqual(new Set(again), new Set(known));
  assert.equal(readdirSync(dirname(first)).length, 3);
  await reserve();
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).cwds.length, 4, "with all three held, the next chat gets a new folder");
});

test("a folder is not taken again once it holds a file, has a session, is gone, or lies under a former root", async () => {
  const { dir, agent } = fixture();
  const withFile = await reserve();
  const withSession = await reserve();
  const removed = await reserve();
  const kept = await reserve();
  writeFileSync(join(withFile, "notes.txt"), "an attachment of a chat that never started");
  const sessions = join(agent, "sessions", "--fixture--");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "2026-01-01T00-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl"),
    JSON.stringify({ type: "session", version: 3, id: "11111111-1111-4111-8111-111111111111", timestamp: "2026-01-01T00:00:00.000Z", cwd: withSession }) + "\n");
  invalidateSessionListCache();
  rmSync(removed, { recursive: true });
  restart();
  assert.equal(await reserve(), kept, "the one folder that is still empty and unused");
  const fresh = await reserve();
  assert.ok(![withFile, withSession, removed, kept].includes(fresh));
  assert.equal(readFileSync(join(withFile, "notes.txt"), "utf8"), "an attachment of a chat that never started");

  // New chats go to the root chosen now; an empty folder of the former root stays where it is, unused.
  const next = join(dir, "selected");
  mkdirSync(next);
  await success(await put(next));
  restart();
  const moved = await reserve();
  assert.equal(dirname(moved), realpathSync.native(next));
  assert.ok(existsSync(kept) && existsSync(fresh));
});

test("a holder gets the folder it holds until a chat took it: no folder a page load", async () => {
  const { agent } = fixture();
  const as = async (holder) => (await success(await POST(new Request(`http://localhost/api/temp-chats?holder=${holder}`, { method: "POST", headers: { host: "localhost" } })))).cwd;
  const main = await as("desktop-main-window");
  // The page that follows one that went away without a word, as often as it likes.
  for (let load = 0; load < 5; load++) assert.equal(await as("desktop-main-window"), main);
  const tab = await as("tab-1");
  assert.notEqual(tab, main, "another holder never shares it");
  assert.equal(await as("tab-1"), tab);
  assert.equal(readdirSync(dirname(main)).length, 2);

  // A chat started in the folder: it is the chat's, and its holder gets the next one.
  const sessions = join(agent, "sessions", "--fixture--");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "2026-01-01T00-00-00-000Z_22222222-2222-4222-8222-222222222222.jsonl"),
    JSON.stringify({ type: "session", version: 3, id: "22222222-2222-4222-8222-222222222222", timestamp: "2026-01-01T00:00:00.000Z", cwd: main }) + "\n");
  invalidateSessionListCache();
  const next = await as("desktop-main-window");
  assert.ok(![main, tab].includes(next));
  assert.equal(await as("desktop-main-window"), next);

  // A tab that goes away gives its folder back by its name; the next tab takes it.
  assert.deepEqual(await success(await DELETE(new Request("http://localhost/api/temp-chats?holder=tab-1", { method: "DELETE", headers: { host: "localhost" } }))), { released: true });
  assert.equal(await as("tab-2"), tab);
  assert.equal(readdirSync(dirname(main)).length, 3);
  // A name too long to be one is no name: a folder of its own each time.
  assert.notEqual(await as("x".repeat(101)), await as("x".repeat(101)));
});

test("past twenty holders the one that asked longest ago loses its folder to the next", async () => {
  fixture();
  const as = async (holder) => (await success(await POST(new Request(`http://localhost/api/temp-chats?holder=${holder}`, { method: "POST", headers: { host: "localhost" } })))).cwd;
  const first = await as("tab-0");
  // Twenty more tabs, none of which says it went away.
  for (let tab = 1; tab <= 20; tab++) assert.notEqual(await as(`tab-${tab}`), first);
  assert.equal(await as("tab-21"), first, "no folder is made while one is held by a tab nobody heard of again");
  assert.equal(readdirSync(dirname(first)).length, 21);
});
