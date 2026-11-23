// Start the isolated-model-import preview, then run: node e2e/model-import.mjs [port]
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = `http://127.0.0.1:${Number(process.argv[2] || 30243)}`;
// Never navigate to the application, even if another server is on this port.
const identity = await fetch(`${origin}/api/fixture-id`, { redirect: "error" });
assert.deepEqual(await identity.json(), { fixture: "isolated-model-import-v1" });
const results = fileURLToPath(new URL("../test-results/model-import/", import.meta.url));
await fs.mkdir(results, { recursive: true });
const browser = await chromium.launch({ channel: existsSync(chromium.executablePath()) ? "chromium" : "chrome",
  args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
page.setDefaultTimeout(10000);
const checks = [], writes = [], defaults = [], catalog = [], violations = [], errors = [];
const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
page.on("pageerror", err => errors.push(err.message));
page.on("request", req => {
  if (req.url() === `${origin}/api/models-config` && req.method() === "PUT") writes.push(req.postDataJSON());
  if (req.url() === `${origin}/api/models-config/import-defaults` && req.method() === "PUT") defaults.push(req.postDataJSON());
  if (req.url() === `${origin}/api/models-config/catalog`) catalog.push(req.postDataJSON());
});
await page.route("**/*", route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  violations.push(route.request().url()); return route.abort();
});
const btn = name => page.getByRole("button", { name, exact: true });
const field = page.getByRole("textbox", { name: "Default context window (tokens)" });
const save = async () => {
  const [reply, defaultsReply] = await Promise.all([
    page.waitForResponse(r => r.url() === `${origin}/api/models-config` && r.request().method() === "PUT"),
    page.waitForResponse(r => r.url() === `${origin}/api/models-config/import-defaults` && r.request().method() === "PUT"),
    btn("Save").click(),
  ]);
  assert.equal(reply.status(), 200); assert.equal(defaultsReply.status(), 200);
  return writes.at(-1).providers;
};
const discover = () => btn("Import models…").click();
const pick = async (...ids) => {
  for (const id of ids) await page.getByRole("checkbox", { name: id, exact: true }).check();
  await btn(`Add selected (${ids.length})`).click();
};
const reopen = async () => { await btn("Close").click(); await btn("Open fixture models").click(); await field.waitFor(); };
const bulk = () => btn("Apply to all").click();
const cost = { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 };
const existing = { id: "existing", contextWindow: 8192, maxTokens: 512, reasoning: false };
const untouched = [{ id: "untouched", contextWindow: 1024 }];
const matched = { id: "match", name: "Catalog Name", contextWindow: 131072, maxTokens: 4096, reasoning: true, input: ["text", "image"], cost };
let failure;
try {
  await page.goto(origin);
  await btn("alpha").click(); await discover();
  await pick("match", "missing");
  await page.getByText(/Added 2.*Catalog matches: 1.*Not matched: 1/).waitFor();
  assert.equal(writes.length, 0);
  assert.deepEqual(catalog, [{ ids: ["match", "missing"], provider: "alpha", baseUrl: `${origin}/fixture/alpha` }]);
  let providers = await save();
  assert.deepEqual(providers.alpha.models, [existing, { id: "no-window" }, matched, { id: "missing" }]);
  pass("Catalog fills new model metadata and cost; unmatched model still added; no implicit save");

  await field.fill("65536");
  providers = await save();
  assert.deepEqual(defaults.at(-1), { contextWindows: { alpha: 65536 } });
  assert.equal(JSON.stringify(writes).includes("piWebImport"), false, "models.json never holds the default");
  assert.deepEqual(providers.alpha.models, [existing, { id: "no-window" }, matched, { id: "missing" }]);
  pass("Saving the default alone preserves every original model");

  await pick("offline");
  await page.getByText(/Catalog lookup failed for 1; models still added/).waitFor();
  providers = await save();
  assert.deepEqual(providers.alpha.models.at(-1), { id: "offline", contextWindow: 65536 });
  pass("A catalog 503 still adds the model with the provider default");

  let release, arrived;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  await page.route("**/api/models-config/catalog", async route => { arrived(); await gate; await route.fallback(); }, { times: 1 });
  await pick("override"); await started;
  try {
    await btn("beta").click();
    assert.equal(await field.inputValue(), "");
    assert.equal(await page.locator("footer button").last().isDisabled(), true);
  } finally { release(); }
  providers = await save();
  assert.deepEqual(providers.beta.models, untouched);
  assert.deepEqual(providers.alpha.models.at(-1), { ...matched, id: "override", name: "Override Name", contextWindow: 65536 });
  pass("Switch during lookup: late reply fills only alpha; its default overrides the catalog window");

  await btn("alpha").click();
  const beforeApply = writes.length;
  assert.ok((await field.boundingBox()).y < (await page.getByText("Headers", { exact: true }).boundingBox()).y);
  const beforeBox = await btn("Apply to all").boundingBox();
  await bulk();
  await btn("Applied").waitFor();
  assert.deepEqual(await btn("Applied").boundingBox(), beforeBox);
  await btn("Apply to all").waitFor();
  assert.equal(await btn("Confirm").count(), 0);
  assert.equal(writes.length, beforeApply);
  const before = providers.alpha.models;
  providers = await save();
  assert.deepEqual(providers.alpha.models, before.map(model => ({ ...model, contextWindow: 65536 })));
  assert.deepEqual(providers.beta.models, untouched);
  pass("One click applies without confirmation; Save changes only the selected provider's model windows");

  await reopen(); await btn("alpha").click();
  assert.equal(await field.inputValue(), "65536"); await discover();
  assert.equal(await page.getByRole("checkbox", { name: /override.*added/i }).isDisabled(), true);
  await btn("beta").click(); assert.equal(await field.inputValue(), "");
  await btn("alpha").click(); await discover();
  await page.screenshot({ path: `${results}/verified.png` });
  pass("Close and reopen reads the saved provider default and does not offer imported IDs again");
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  assert.equal(JSON.stringify(writes).includes("piWebImport"), false);
  assert.ok(defaults.length > 0 && defaults.every(body => Object.keys(body.contextWindows).every(provider => provider === "alpha")), "no provider but alpha ever gets a default");
  pass("No uncaught page errors or external browser requests");
} catch (err) {
  failure = String(err?.stack ?? err);
  await page.screenshot({ path: `${results}/failure.png` }).catch(() => {});
  throw err;
} finally {
  await fs.writeFile(`${results}/results.json`, JSON.stringify({ timestamp: new Date().toISOString(), passed: !failure, checks, failure, errors, externalRequests: violations, configWrites: writes.length, catalog }, null, 2));
  await browser.close();
}
