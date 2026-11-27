import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareRouteCache } from "../src/route-cache.mjs";

test("an in-place upgrade discards older pages and a restart keeps the current cache", (t) => {
  const server = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-route-cache-"));
  t.after(() => fs.rmSync(server, { recursive: true, force: true }));
  const cache = path.join(server, ".next", "server", "route-cache");
  const oldPage = path.join(cache, "APP_PAGE", "index.html");
  const buildId = path.join(server, ".next", "BUILD_ID");
  fs.mkdirSync(path.dirname(oldPage), { recursive: true });
  fs.writeFileSync(oldPage, "old sidebar");
  fs.writeFileSync(buildId, "new-build\n");

  prepareRouteCache(server);
  assert.equal(fs.existsSync(oldPage), false);

  fs.mkdirSync(path.dirname(oldPage));
  fs.writeFileSync(oldPage, "new sidebar");
  prepareRouteCache(server);
  assert.equal(fs.readFileSync(oldPage, "utf8"), "new sidebar");

  fs.writeFileSync(buildId, "another-build");
  prepareRouteCache(server);
  assert.equal(fs.existsSync(oldPage), false);
});
