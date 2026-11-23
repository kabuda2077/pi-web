import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";
import { ModelConfig } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(import.meta.dirname, "..") } });
const { importContextWindows, importPresets, saveImportDefaults, withImportDefaults, withoutImportDefaults } = await jiti.import("./model-import.ts");
const { GET, POST } = await jiti.import("../app/api/models-config/catalog/route.ts");

test("import uses the manual exact-match preset; one catalog read, no provider credentials", async (t) => {
  const requests = [];
  const source = { local: { name: "Local", models: { m: { id: "m", name: "Demo", limit: { context: 12000, output: 3000 }, cost: { input: 1, output: 2 } } } } };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(url);
    if (url === "https://models.dev/api.json") return Response.json(source);
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ["baseUrl", "ids", "provider"]);
    return POST(new Request(`http://localhost${url}`, options));
  });
  const { presets, failed } = await importPresets(["m", "unknown"], "local", "http://localhost/v1");
  const single = await (await GET(new Request("http://localhost/catalog?q=m&provider=local"))).json();
  assert.deepEqual(presets.get("m"), single.recommendation.preset);
  assert.equal(presets.get("m").contextWindow, 12000);
  assert.equal(presets.has("unknown"), false);
  assert.equal(failed, 0);
  assert.deepEqual(requests, ["/api/models-config/catalog", "https://models.dev/api.json"]);
});

test("import batches large selections and keeps earlier matches on failure", async (t) => {
  const ids = Array.from({ length: 601 }, (_, i) => `model-${i}`);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, { body }) => {
    assert.equal(JSON.parse(body).ids.length, 300);
    if (++calls === 1) return Response.json({ presets: [{ id: ids[0], preset: { maxTokens: 1000 } }] });
    return new Response(null, { status: 502 });
  });
  const result = await importPresets(ids, "local");
  assert.equal(calls, 2);
  assert.equal(result.failed, 301);
  assert.equal(result.presets.get(ids[0]).maxTokens, 1000);
});

test("a provider's import default is kept out of models.json: split off before the save, merged back on load", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-import-sdk-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const defaults = await jiti.import("../app/api/models-config/import-defaults/route.ts");
  t.mock.method(globalThis, "fetch", (url, options = {}) => {
    assert.equal(url, "/api/models-config/import-defaults");
    return defaults[options.method ?? "GET"](new Request(`http://localhost${url}`, { ...options, headers: { host: "localhost", ...options.headers } }));
  });

  const local = { piWebImportContextWindow: "200000", baseUrl: "http://localhost/v1", api: "openai-responses", models: [{ id: "exception", contextWindow: 40000 }] };
  const draft = { providers: { local, other: { models: [{ id: "other", contextWindow: 128000 }] } } };
  assert.deepEqual(importContextWindows(draft), { local: 200000 });
  const forPi = withoutImportDefaults(draft);
  assert.equal("piWebImportContextWindow" in forPi.providers.local, false);
  assert.equal(local.piWebImportContextWindow, "200000", "the draft itself keeps what was typed");
  assert.deepEqual(forPi.providers.local.models, local.models);
  assert.equal(forPi.providers.other, draft.providers.other);

  // What Save writes: pi reads models.json as its own, and the default comes back from the fork's file.
  await saveImportDefaults(draft);
  const file = path.join(dir, "models.json");
  await writeFile(file, JSON.stringify(forPi));
  const loaded = await ModelConfig.load(file);
  assert.equal(loaded.getError(), undefined);
  assert.equal(JSON.stringify(Object.fromEntries(loaded.getProviderIds().map((id) => [id, loaded.getProvider(id)]))).includes("piWebImport"), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "pi-web-model-import.json"), "utf8")), { contextWindows: { local: 200000 } });
  const reopened = await withImportDefaults(JSON.parse(await readFile(file, "utf8")));
  assert.deepEqual(reopened, { providers: { local: { ...forPi.providers.local, piWebImportContextWindow: 200000 }, other: draft.providers.other } });

  // A provider that is renamed or removed takes its default along: the saved set is the draft's.
  await saveImportDefaults({ providers: { renamed: { ...local, piWebImportContextWindow: 64000 } } });
  assert.deepEqual((await withImportDefaults({ providers: { local: {}, renamed: {} } })).providers, { local: {}, renamed: { piWebImportContextWindow: 64000 } });
  await saveImportDefaults({ providers: { renamed: {} } });
  assert.deepEqual((await withImportDefaults({ providers: { renamed: {} } })).providers, { renamed: {} });

  for (const invalid of [0, -1, 1.5, "1e4", "no", Number.MAX_SAFE_INTEGER + 1]) {
    const bad = { providers: { local: { ...local, piWebImportContextWindow: invalid } } };
    assert.throws(() => importContextWindows(bad), (error) => error.model === "local");
    await assert.rejects(saveImportDefaults(bad));
    assert.equal((await defaults.PUT(new Request("http://localhost/x", { method: "PUT", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ contextWindows: { local: invalid } }) }))).status, 400);
  }
  assert.equal((await defaults.PUT(new Request("http://localhost/x", { method: "PUT", headers: { host: "localhost", origin: "https://example.org", "content-type": "application/json" }, body: "{}" }))).status, 403);

  // A file nobody can read as defaults, or a server that does not answer, leaves the providers as they are.
  await writeFile(path.join(dir, "pi-web-model-import.json"), "{");
  assert.deepEqual(await withImportDefaults(forPi), forPi);
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error("offline"); });
  assert.equal(await withImportDefaults(forPi), forPi);
});
