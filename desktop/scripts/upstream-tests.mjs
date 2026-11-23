import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { desktopDir, repoDir } from "./paths.mjs";
import { withUpstreamTestEnv } from "./upstream-test-env.mjs";

// Runs pi-web's own tests (`npm test` in the repository root) and compares the
// failures with the ones this machine is known to have
// (upstream-tests.baseline.json). pi-web's tests are written on macOS and
// Linux, and some fail on Windows whatever this fork changes; only a failure
// that is not in the baseline says something broke.
//
//   node scripts/upstream-tests.mjs            compare, exit 1 on a new failure
//   node scripts/upstream-tests.mjs --update   rewrite the baseline from this run

const baselinePath = path.join(desktopDir, "upstream-tests.baseline.json");
const resultPath = path.join(desktopDir, "node_modules", ".cache", "upstream-tests.jsonl");
const update = process.argv.includes("--update");

/**
 * pi-web's own test command, with this script's reporter added.
 *
 * @param {string[]} [files] Run only these test files instead of all
 */
function testCommand(files) {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8"));
  const command = scripts.test;
  if (!/^node .*--test /.test(command)) throw new Error(`pi-web's test script is no longer a node --test run: ${command}`);
  const reporter = pathToFileURL(path.join(import.meta.dirname, "upstream-reporter.mjs")).href;
  const withReporter = command.replace("--test ", `--test --test-reporter="${reporter}" --test-reporter-destination="${resultPath}" `);
  if (!files) return withReporter;
  // Everything up to the first quoted file pattern, then the files.
  return `${withReporter.slice(0, withReporter.indexOf(' "app/'))} ${files.map((file) => `"${file}"`).join(" ")}`;
}

function runTests(files) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.rmSync(resultPath, { force: true });
  return withUpstreamTestEnv((env) => new Promise((resolve, reject) => {
    const child = spawn(testCommand(files), { cwd: repoDir, env, shell: true, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("close", resolve);
  }));
}

function readResults() {
  const failures = [];
  let totals = null;
  for (const line of fs.readFileSync(resultPath, "utf8").split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.totals) totals = entry.totals;
    else failures.push(entry);
  }
  if (!totals) throw new Error("The test run did not finish: no totals were written");
  return { failures, totals };
}

/** A failure's name in the baseline: its file and its test, the same after upstream moves lines. */
const keyOf = (failure) => `${failure.file} :: ${failure.name}`;

function countByKey(failures) {
  const counts = new Map();
  for (const failure of failures) counts.set(keyOf(failure), (counts.get(keyOf(failure)) ?? 0) + 1);
  return counts;
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch {
    return { failures: {} };
  }
}

const startedAt = Date.now();
await runTests();
const { failures, totals } = readResults();
const counts = countByKey(failures);
const baseline = readBaseline();
console.log(`\n${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped in ${Math.round((Date.now() - startedAt) / 1000)} s`);

if (update) {
  const known = {};
  for (const key of [...counts.keys()].sort()) {
    known[key] = { count: counts.get(key), why: baseline.failures[key]?.why ?? "" };
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8"));
  fs.writeFileSync(baselinePath, `${JSON.stringify({ piWeb: version, node: process.version, failures: known }, null, 2)}\n`);
  console.log(`Baseline rewritten: ${Object.keys(known).length} known failures`);
  process.exit(0);
}

const beyondBaseline = (list, tally) => list.filter((failure) => tally.get(keyOf(failure)) > (baseline.failures[keyOf(failure)]?.count ?? 0));
let fresh = beyondBaseline(failures, counts);
let flaky = [];
if (fresh.length > 0) {
  // Some of pi-web's tests depend on timing and fail now and then in a full
  // run: a new failure counts only when its file fails the same way on its own.
  console.log(`\n${fresh.length} failure(s) outside the baseline: running their files again`);
  await runTests([...new Set(fresh.map((failure) => failure.file))]);
  const again = readResults().failures;
  const repeated = new Set(beyondBaseline(again, countByKey(again)).map(keyOf));
  flaky = fresh.filter((failure) => !repeated.has(keyOf(failure)));
  fresh = fresh.filter((failure) => repeated.has(keyOf(failure)));
}
const fixed = Object.keys(baseline.failures).filter((key) => (counts.get(key) ?? 0) < baseline.failures[key].count);

console.log(`Known failures on this machine: ${failures.length - fresh.length - flaky.length} of the ${Object.values(baseline.failures).reduce((sum, entry) => sum + entry.count, 0)} in the baseline`);
if (fixed.length > 0) {
  console.log(`\nIn the baseline and passing now (run with --update to drop them):`);
  for (const key of fixed) console.log(`  ${key}`);
}
if (flaky.length > 0) {
  console.log(`\nFailed once and passed when run again (timing):`);
  for (const failure of flaky) console.log(`  ${keyOf(failure)}`);
}
if (fresh.length > 0) {
  console.log(`\nNEW failures (${fresh.length}):`);
  for (const failure of fresh) {
    console.log(`  ${keyOf(failure)}\n      ${failure.code} ${failure.message.split("\n")[0].slice(0, 300)}`);
  }
  process.exit(1);
}
console.log("\nNo new failures.");
