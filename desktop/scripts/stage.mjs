import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NODE_RUNTIME, repoDir, stageDir, workDir } from "./paths.mjs";

// Puts together what the app carries besides its own shell:
//
//   stage/server   pi-web exactly as its npm package holds it (`npm pack`),
//                  plus its production dependencies from pi-web's lockfile
//   stage/node     the Node.js that runs it, with npm for plugin installs
//
// Nothing here is specific to a pi-web version: a new upstream release is
// staged the same way.

const SYSTEM_TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

function log(message) {
  console.log(`[stage] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(" ")} exited with ${result.status}`);
  return result;
}

/** npm through its script under the running Node: on Windows `npm` is a .cmd, which cannot be spawned without a shell. */
function npm(args, options) {
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(cli)) throw new Error(`npm was not found next to ${process.execPath}`);
  return run(process.execPath, [cli, ...args], options);
}

function extract(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  // Windows' own tar reads both .tgz and .zip.
  run(SYSTEM_TAR, ["-xf", archive, "-C", into]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stageServer({ skipBuild }) {
  const serverDir = path.join(stageDir, "server");
  const packDir = path.join(workDir, "pack");

  if (!fs.existsSync(path.join(repoDir, "node_modules", "next", "package.json"))) {
    log("installing pi-web's dependencies");
    npm(["ci", "--no-audit", "--no-fund"], { cwd: repoDir });
  }
  if (skipBuild && fs.existsSync(path.join(repoDir, ".next", "BUILD_ID"))) {
    log("reusing the existing pi-web build (--skip-build)");
  } else {
    log("building pi-web");
    npm(["run", "build"], { cwd: repoDir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  }

  log("packing pi-web as its npm package");
  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  const packed = npm(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: repoDir,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const [{ filename, files }] = JSON.parse(packed.stdout);
  extract(path.join(packDir, filename), packDir);
  fs.renameSync(path.join(packDir, "package"), serverDir);
  // A build that has served pages holds copies of them here, which Next.js
  // would keep serving after an update (pi-web docs/release.md).
  fs.rmSync(path.join(serverDir, ".next", "server", "route-cache"), { recursive: true, force: true });
  log(`pi-web package: ${files.length} files`);

  log("installing pi-web's production dependencies from its lockfile");
  const lockfile = path.join(serverDir, "package-lock.json");
  fs.copyFileSync(path.join(repoDir, "package-lock.json"), lockfile);
  // No dependency runs install scripts, as in pi-web's Dockerfile: node-pty loads its prebuilt binary.
  npm(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: serverDir });
  fs.rmSync(lockfile);

  // Source maps are read only by `next dev` and `node --enable-source-maps`, neither of
  // which runs here. pi-web's own package leaves its .next ones out (`files` in its
  // package.json); the dependencies' are a fifth of the payload and a quarter of its files.
  const maps = removeSourceMaps(path.join(serverDir, "node_modules"));
  log(`removed ${maps.count} source maps from the dependencies (${Math.round(maps.bytes / 1024 / 1024)} MB)`);
  return serverDir;
}

function removeSourceMaps(dir) {
  let count = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".map")) continue;
    const file = path.join(entry.parentPath, entry.name);
    bytes += fs.statSync(file).size;
    fs.rmSync(file);
    count += 1;
  }
  return { count, bytes };
}

async function stageNode() {
  const nodeDir = path.join(stageDir, "node");
  const downloads = path.join(workDir, "downloads");
  const archive = path.join(downloads, NODE_RUNTIME.file);
  const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  if (!fs.existsSync(archive) || sha256(archive) !== NODE_RUNTIME.sha256) {
    const url = `https://nodejs.org/dist/v${NODE_RUNTIME.version}/${NODE_RUNTIME.file}`;
    log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
    fs.mkdirSync(downloads, { recursive: true });
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    if (sha256(archive) !== NODE_RUNTIME.sha256) {
      fs.rmSync(archive);
      throw new Error(`${NODE_RUNTIME.file} does not match its published checksum`);
    }
  }

  const unpacked = path.join(downloads, path.basename(NODE_RUNTIME.file, ".zip"));
  fs.rmSync(unpacked, { recursive: true, force: true });
  extract(archive, downloads);
  // node.exe, and npm for the plugins and skills pi installs. Not corepack or the installer's helpers.
  for (const name of ["node.exe", "LICENSE", "npm", "npm.cmd", "npm.ps1", "npx", "npx.cmd", "npx.ps1"]) {
    fs.cpSync(path.join(unpacked, name), path.join(nodeDir, name));
  }
  fs.cpSync(path.join(unpacked, "node_modules", "npm"), path.join(nodeDir, "node_modules", "npm"), { recursive: true });
  fs.rmSync(unpacked, { recursive: true, force: true });
  return nodeDir;
}

function checkPayload(serverDir, nodeDir) {
  const mustExist = [
    [serverDir, "bin", "pi-web.js"],
    [serverDir, ".next", "BUILD_ID"],
    [serverDir, "public", "icons", "icon-192.png"],
    [serverDir, "node_modules", "next", "package.json"],
    [serverDir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"],
    [serverDir, "node_modules", "node-pty", "prebuilds", "win32-x64", "conpty.node"],
    [nodeDir, "node.exe"],
    [nodeDir, "node_modules", "npm", "bin", "npx-cli.js"],
  ];
  const mustNotExist = [
    [serverDir, ".next", "cache"],
    [serverDir, ".next", "dev"],
    [serverDir, ".next", "server", "route-cache"],
    [serverDir, "node_modules", "typescript"],
    [serverDir, "node_modules", "playwright"],
  ];
  for (const parts of mustExist) {
    if (!fs.existsSync(path.join(...parts))) throw new Error(`the payload lacks ${path.join(...parts)}`);
  }
  for (const parts of mustNotExist) {
    if (fs.existsSync(path.join(...parts))) throw new Error(`the payload must not hold ${path.join(...parts)}`);
  }

  // The carried Node.js must be able to run the launcher it will be given.
  const launcher = path.join(serverDir, "bin", "pi-web.js");
  const version = spawnSync(path.join(nodeDir, "node.exe"), [launcher, "version"], { encoding: "utf8", windowsHide: true });
  const expected = readJson(path.join(serverDir, "package.json")).version;
  if (version.status !== 0 || version.stdout.trim() !== expected) {
    throw new Error(`the carried Node.js could not run pi-web's launcher: ${version.stderr || version.stdout || version.error}`);
  }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoDir, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Builds the payload under stage/ and returns what it holds.
 *
 * @param options.skipBuild Reuse pi-web's existing build in .next instead of building it again
 */
export async function stage({ skipBuild = false } = {}) {
  const startedAt = Date.now();
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const serverDir = stageServer({ skipBuild });
  const nodeDir = await stageNode();
  checkPayload(serverDir, nodeDir);

  const manifest = {
    piWeb: readJson(path.join(serverDir, "package.json")).version,
    pi: readJson(path.join(serverDir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")).version,
    node: NODE_RUNTIME.version,
    commit: git(["rev-parse", "HEAD"]),
    // Changes not committed yet went into this build.
    uncommitted: Boolean(git(["status", "--porcelain", "--", ".", ":!desktop"])),
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(stageDir, "build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`done in ${Math.round((Date.now() - startedAt) / 1000)} s: pi-web ${manifest.piWeb}, pi ${manifest.pi}, Node.js ${manifest.node}`);
  return manifest;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? "")) {
  await stage({ skipBuild: process.argv.includes("--skip-build") });
}
