import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repoDir } from "../scripts/paths.mjs";
import { withUpstreamTestEnv } from "../scripts/upstream-test-env.mjs";

function setEnv(t, key, value) {
  const before = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
}

test("each attempt gets a clean home and temp, even after a failed run", async (t) => {
  for (const key of ["PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "NODE_PATH"]) setEnv(t, key, repoDir);
  const roots = [];
  async function check(env) {
    const probe = `console.log(JSON.stringify([process.cwd(), require('os').homedir(), require('os').tmpdir(),
      process.env.PI_CODING_AGENT_DIR, process.env.XDG_CONFIG_HOME, process.env.NODE_PATH]))`;
    const observed = JSON.parse(execFileSync(process.execPath, ["-e", probe], { cwd: repoDir, env, encoding: "utf8" }));
    assert.deepEqual(observed, [repoDir, env.HOME, env.TMP, null, null, null]);
    assert.equal(env.HOME, env.USERPROFILE);
    assert.equal(env.TMP, env.TEMP);
    const root = path.dirname(env.HOME);
    assert.equal(path.dirname(env.TMP), root);
    assert.notEqual(env.HOME, env.TMP);
    assert.ok(!roots.includes(root));
    roots.push(root);
    for (const dir of [env.HOME, env.TMP]) fs.writeFileSync(path.join(dir, "test-marker"), "", { flag: "wx" });
  }
  await assert.rejects(withUpstreamTestEnv(async (env) => { await check(env); throw new Error("fixture failure"); }), /fixture failure/);
  assert.ok(!fs.existsSync(roots[0]));
  await withUpstreamTestEnv(check);
  assert.ok(!fs.existsSync(roots[1]));
});

test("unsafe overrides fail before running tests", async (t) => {
  await withUpstreamTestEnv(async ({ TMP: tmp }) => {
    setEnv(t, "PI_WEB_UPSTREAM_TEST_ROOT", repoDir);
    const nested = path.join(tmp, "nested");
    fs.mkdirSync(nested);
    async function rejected(parent) {
      process.env.PI_WEB_UPSTREAM_TEST_ROOT = parent;
      await assert.rejects(withUpstreamTestEnv(() => assert.fail("runner started")), /No safe writable upstream test root.*PI_WEB_UPSTREAM_TEST_ROOT/);
    }
    await rejected(repoDir);
    await rejected(os.userInfo().homedir);
    await rejected(path.join(tmp, "missing"));
    for (const marker of [".agents/skills", ".git", "node_modules"]) {
      const entry = path.join(tmp, marker);
      fs.mkdirSync(entry, { recursive: true });
      await rejected(nested);
      fs.rmdirSync(entry);
    }
  });
});
