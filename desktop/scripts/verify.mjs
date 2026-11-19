import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { outDir } from "./paths.mjs";

// Runs the built app's own self-test (src/selftest.mjs), then kills the app and
// checks that its server goes with it.
// Nothing shows on screen, and the user's sessions and settings are not touched:
// every run gets a throwaway profile and agent directory.
//
//   node scripts/verify.mjs [path to the app's .exe]

const RUN_TIMEOUT_MS = 240_000;
const SERVER_EXIT_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findApp() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const unpacked = path.join(outDir, "win-unpacked");
  const exe = fs.existsSync(unpacked) ? fs.readdirSync(unpacked).find((name) => name.endsWith(".exe")) : null;
  if (!exe) throw new Error(`No built app in ${unpacked}: run "npm run pack" first`);
  return path.join(unpacked, exe);
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readReport(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  } catch {
    return null;
  }
}

/** The records `pi-web status` would list for the run in dir. */
function runRecords(dir) {
  const runDir = path.join(dir, "agent", "pi-web-run");
  return fs.existsSync(runDir) ? fs.readdirSync(runDir) : [];
}

function printChecks(title, checks) {
  console.log(`\n${title}`);
  for (const check of checks) {
    const detail = check.ok || check.detail === undefined ? "" : `  ${JSON.stringify(check.detail).slice(0, 400)}`;
    console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}${detail}`);
  }
}

/** Starts the app on a self-test folder: a fresh one, or the one an earlier run used. */
function launch(app, extraArgs, dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-verify-"))) {
  const child = spawn(app, [`--self-test=${dir}`, ...extraArgs], { stdio: "ignore", windowsHide: true });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  return { dir, child, exited };
}

/** Runs one self-test scenario to its end. */
async function runScenario(app, scenario) {
  const { dir, child, exited } = launch(app, [`--self-test-scenario=${scenario}`]);
  const code = await Promise.race([exited, sleep(RUN_TIMEOUT_MS).then(() => "timeout")]);
  if (code === "timeout") child.kill();
  const report = readReport(dir);
  const checks = report?.checks ?? [];
  checks.push({ name: "the app wrote its report and exited cleanly", ok: code === 0 && report?.ok === true, detail: { code, error: report?.error } });
  if (report?.consoleErrors?.length) checks.push({ name: "the page logged no errors", ok: false, detail: report.consoleErrors.slice(0, 5) });

  // A normal exit takes the server and its run record along.
  const serverPids = report?.serverPids ?? [];
  const leftBehind = serverPids.filter(isRunning);
  checks.push({ name: "no server process is left after exit", ok: leftBehind.length === 0, detail: leftBehind });
  checks.push({ name: "no run record is left after exit", ok: runRecords(dir).length === 0, detail: runRecords(dir) });
  printChecks(`Scenario "${scenario}" (report in ${dir})`, checks);
  return { ok: checks.every((check) => check.ok), report };
}

/** Kills the app, as a crash or Task Manager would, without letting it stop its server. */
async function runCrash(app) {
  const { dir, child, exited } = launch(app, ["--self-test-hold"]);
  const checks = [];
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let report = null;
  while (!(report = readReport(dir)) && Date.now() < deadline && child.exitCode === null) await sleep(500);
  checks.push({ name: "the app reached the end of its self-test", ok: report?.ok === true, detail: report?.error });

  // The last launcher and Next.js process the self-test saw are the ones still serving.
  const serverPids = (report?.serverPids ?? []).slice(-2);
  checks.push({ name: "its server is running", ok: serverPids.length === 2 && serverPids.every(isRunning), detail: serverPids });

  child.kill("SIGKILL");
  await exited;
  const serverGoneBy = Date.now() + SERVER_EXIT_TIMEOUT_MS;
  while (serverPids.some(isRunning) && Date.now() < serverGoneBy) await sleep(250);
  checks.push({ name: "the server ends when the app is killed", ok: !serverPids.some(isRunning), detail: serverPids.filter(isRunning) });

  // The killed launcher could not remove its run record. The next launch, on the same data, has pi-web drop it.
  const left = runRecords(dir);
  const next = launch(app, [], dir);
  const code = await Promise.race([next.exited, sleep(RUN_TIMEOUT_MS).then(() => "timeout")]);
  if (code === "timeout") next.child.kill();
  checks.push({ name: "the next launch works", ok: code === 0 && readReport(dir)?.ok === true, detail: { code } });
  checks.push({ name: "the next launch drops the killed server's run record", ok: left.length === 1 && runRecords(dir).length === 0, detail: { left, now: runRecords(dir) } });
  printChecks(`Scenario "app is killed" (report in ${dir})`, checks);
  return { ok: checks.every((check) => check.ok) };
}

const app = findApp();
console.log(`Verifying ${app}`);
const works = await runScenario(app, "works");
const fails = await runScenario(app, "server-fails");
const crash = await runCrash(app);

if (works.report?.processes) {
  const total = (list) => Math.round(list.reduce((sum, entry) => sum + entry.megabytes, 0));
  const { withPage, released } = works.report.processes;
  console.log(`\nThe shell's own memory (the server is separate): ${total(withPage)} MB with a page, ${total(released ?? [])} MB after releasing it`);
}

const ok = works.ok && fails.ok && crash.ok;
console.log(ok ? "\nAll checks passed." : "\nSome checks FAILED.");
process.exit(ok ? 0 : 1);
