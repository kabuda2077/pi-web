import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NODE_RUNTIME, repoDir, stageDir, workDir } from "./paths.mjs";
import { stageRuntimePackages } from "./standalone-runtime.mjs";

// Puts together what the app carries besides its own shell:
//
//   stage/server   Next.js standalone, the pi-web launcher and dynamic dependencies
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
  const nextDir = path.join(repoDir, ".next");
  const standaloneDir = path.join(nextDir, "standalone");

  if (!fs.existsSync(path.join(repoDir, "node_modules", "next", "package.json"))) {
    log("installing pi-web's dependencies");
    npm(["ci", "--no-audit", "--no-fund"], { cwd: repoDir });
  }
  if (skipBuild) {
    log("reusing the existing standalone build (--skip-build)");
  } else {
    log("building pi-web standalone");
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("__NEXT_PRIVATE_")));
    npm(["run", "build"], {
      cwd: repoDir,
      env: { ...env, NEXT_TELEMETRY_DISABLED: "1", PI_WEB_DESKTOP_BUILD: "1" },
    });
  }
  const standaloneBuildId = path.join(standaloneDir, ".next", "BUILD_ID");
  if (!fs.existsSync(path.join(standaloneDir, "server.js")) || !fs.existsSync(standaloneBuildId)
      || fs.readFileSync(standaloneBuildId, "utf8") !== fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8")) {
    throw new Error("The current Next.js build has no matching standalone output. Build without --skip-build.");
  }

  // Stage the traced runtime and explicit project assets. Next's standalone
  // output can also contain project environment files, which stay local.
  for (const name of ["server.js", ".next", "node_modules"]) {
    fs.cpSync(path.join(standaloneDir, name), path.join(serverDir, name), { recursive: true });
  }
  for (const name of ["bin", "public", "package.json"]) {
    fs.cpSync(path.join(repoDir, name), path.join(serverDir, name), { recursive: true });
  }
  fs.cpSync(path.join(nextDir, "static"), path.join(serverDir, ".next", "static"), { recursive: true });
  fs.rmSync(path.join(serverDir, ".next", "server", "route-cache"), { recursive: true, force: true });

  // Pi loads provider modules and extension tools dynamically. Next's trace
  // covers the web runtime, so only fill the runtime closure of these packages.
  const { dependencies } = readJson(path.join(repoDir, "package.json"));
  const piPackages = Object.keys(dependencies).filter(name => name.startsWith("@earendil-works/"));
  const restored = stageRuntimePackages(repoDir, serverDir, ["node-pty", ...piPackages]);
  log(`restored ${restored} runtime packages for pi and the terminal`);

  // File traces describe build-machine paths and are only used by the build.
  const metadata = removeBuildMetadata(serverDir);
  log(`removed ${metadata.count} build metadata files (${Math.round(metadata.bytes / 1024 / 1024)} MB)`);
  return serverDir;
}

function removeBuildMetadata(dir) {
  let count = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !(entry.name.endsWith(".map") || entry.name.endsWith(".nft.json"))) continue;
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
    [serverDir, "server.js"],
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
