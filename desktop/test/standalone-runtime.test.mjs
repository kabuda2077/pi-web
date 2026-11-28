import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageRuntimePackages } from "../scripts/standalone-runtime.mjs";

test("standalone staging keeps nested dependency versions and tolerates absent optional packages", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-runtime-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const project = path.join(temp, "source");
  const target = path.join(temp, "target");
  const readVersion = relative => JSON.parse(fs.readFileSync(path.join(target, relative, "package.json"), "utf8")).version;
  for (const [relative, manifest] of [
    ["node_modules/payload", { dependencies: { shared: "2" }, optionalDependencies: { platformExtra: "1" } }],
    ["node_modules/payload/node_modules/shared", { version: "2.0.0" }],
    ["node_modules/shared", { version: "1.0.0" }],
    ["node_modules/unrelated", { version: "1.0.0" }],
  ]) {
    const folder = path.join(project, relative);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify(manifest));
  }

  stageRuntimePackages(project, target, ["payload", "shared"]);
  assert.equal(readVersion("node_modules/payload/node_modules/shared"), "2.0.0");
  assert.equal(readVersion("node_modules/shared"), "1.0.0");
  assert.equal(fs.existsSync(path.join(target, "node_modules/unrelated")), false);
});
