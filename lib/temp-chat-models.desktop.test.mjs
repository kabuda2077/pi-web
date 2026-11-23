import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

// A General chat's composer is an ordinary new-session composer in the chat's
// reserved folder. pi-web's own model routes, which this fork leaves as they
// are, must serve that folder, or the composer shows "Access denied" where the
// model's name belongs.
test("a reserved General chat folder lists and saves models through pi-web's routes; its root and neighbours stay closed", async t => {
  const home = await mkdtemp(join(tmpdir(), "pi-web-model-draft-"));
  const agent = join(home, "agent");
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (!/^(path|systemroot|windir|comspec|pathext|temp|tmp)$/i.test(key)) delete process.env[key];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1" });
  t.after(async () => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); await rm(home, { recursive: true, force: true }); });
  await mkdir(agent);
  await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: "http://127.0.0.1:9", apiKey: "dummy", api: "openai-completions", models: ["first", "second"].map(id => ({ id, name: id, contextWindow: 1024, maxTokens: 64 })) } } }));
  await writeFile(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "first", enabledModels: ["fixture/first"] }));
  const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } });
  const { GET } = await jiti.import("../app/api/models/route.ts");
  const { PUT } = await jiti.import("../app/api/models/default/route.ts");
  const { POST: reserve } = await jiti.import("../app/api/temp-chats/route.ts");
  const list = query => GET(new Request(`http://localhost/api/models${query}`));
  const save = cwd => PUT(new Request("http://localhost/api/models/default", { method: "PUT", body: JSON.stringify({ provider: "fixture", modelId: "first", cwd }) }));

  const reservation = await reserve(new Request("http://localhost/api/temp-chats", { method: "POST", headers: { host: "localhost" } }));
  assert.equal(reservation.status, 200);
  const { cwd } = await reservation.json();
  const at = encodeURIComponent(cwd);

  const scoped = await list(`?cwd=${at}`);
  assert.equal(scoped.status, 200);
  const data = await scoped.json();
  assert.deepEqual(data.defaultModel, { provider: "fixture", modelId: "first" });
  assert.deepEqual(data.modelList.map(m => m.id), ["first"]);
  const all = await list(`?scope=all&cwd=${at}`);
  assert.equal(all.status, 200);
  assert.ok((await all.json()).modelList.some(m => m.provider === "fixture" && m.id === "second"));
  assert.equal((await save(cwd)).status, 200);

  // Reserving one folder opens that folder only.
  for (const other of [dirname(cwd), join(dirname(cwd), "chat-neighbour"), agent, process.cwd()]) {
    await mkdir(other, { recursive: true });
    assert.equal((await list(`?cwd=${encodeURIComponent(other)}`)).status, 403, other);
    assert.equal((await save(other)).status, 403, other);
  }
});
