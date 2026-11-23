import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { repoDir } from "./paths.mjs";

// Runs the browser checks of the changes this fork makes to pi-web's pages
// (PREVIEWS below). Each runs against a preview of the real components over a
// mock API (e2e/preview-*.mjs): no agent directory, no session and no model is
// touched. A preview that is already serving its port is used as it is;
// otherwise one is started here and stopped at the end.
//
//   node scripts/page-checks.mjs

const START_TIMEOUT_MS = 180_000;
const PREVIEWS = [
  { name: "model-import", port: 30243, fixture: "isolated-model-import-v1", server: "e2e/preview-model-import.mjs", checks: ["e2e/model-import.mjs"] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixtureOf(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/fixture-id`, { redirect: "error", signal: AbortSignal.timeout(3000) });
    return (await response.json()).fixture ?? null;
  } catch {
    return null;
  }
}

/** The preview's own process, or null when one was serving already. */
async function start(preview) {
  if (await fixtureOf(preview.port) === preview.fixture) return null;
  const child = spawn(process.execPath, [preview.server], { cwd: repoDir, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (await fixtureOf(preview.port) !== preview.fixture) {
    const code = await Promise.race([exited, sleep(1000).then(() => null)]);
    if (code !== null) throw new Error(`The ${preview.name} preview ended before it served (exit ${code}): is port ${preview.port} taken by something else?`);
    if (Date.now() > deadline) throw new Error(`The ${preview.name} preview did not serve within ${START_TIMEOUT_MS / 1000} s`);
  }
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  // The preview's build workers go with it.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

function runCheck(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: repoDir, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

const failed = [];
for (const preview of PREVIEWS) {
  let child;
  try {
    child = await start(preview);
    // The first page compiles as it is asked for: let that happen before a check's own time limit runs.
    await fetch(`http://127.0.0.1:${preview.port}/`, { signal: AbortSignal.timeout(START_TIMEOUT_MS) }).then((response) => response.text());
    for (const script of preview.checks) {
      console.log(`\n${path.basename(script)}  (${preview.name} preview${child ? "" : ", already running"})`);
      if (await runCheck(script) !== 0) failed.push(script);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    failed.push(...preview.checks);
  } finally {
    stop(child);
  }
}

if (failed.length > 0) {
  console.log(`\nFAILED: ${[...new Set(failed)].join(", ")}`);
  process.exit(1);
}
console.log("\nAll page checks passed.");
