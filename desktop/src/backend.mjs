import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { prepareRouteCache } from "./route-cache.mjs";

// Next.js prints "Ready" before it has loaded its request handlers, and the
// first request then also waits out the pi SDK import (seconds on Windows), so
// the server counts as up once it has served a whole page, as in pi-web's own
// bin/browser-opener.js.
const FIRST_PAGE_TIMEOUT_MS = 90_000;
const FIRST_PAGE_ATTEMPT_MS = 15_000;
const FIRST_PAGE_RETRY_MS = 200;

// How long a restart waits for the port the stopped server held.
const PORT_RELEASE_MS = 3_000;
const PORT_RETRY_MS = 150;

const RECENT_LINES = 60;
const ANSI_COLORS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const TASKKILL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Binds port (0: any) and lets go of it again. Resolves the bound port, or null when it cannot be had. */
function claim(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen({ port, host, exclusive: true }, () => {
      const bound = probe.address().port;
      probe.close(() => resolve(bound));
    });
  });
}

/**
 * The port to start the server on: the one it had before (a restart must come
 * back on the same origin, or the page would lose its storage), else the
 * preferred one while it is free, else one the OS picks. Null when none can be had.
 */
async function findPort({ previous, preferred, host }) {
  if (previous) {
    for (const deadline = Date.now() + PORT_RELEASE_MS; ; ) {
      if (await claim(previous, host)) return previous;
      if (Date.now() >= deadline) break;
      await sleep(PORT_RETRY_MS);
    }
  }
  return (preferred ? await claim(preferred, host) : null) ?? (await claim(0, host));
}

/** True once url answered a GET with any status and its whole body arrived; false on timeout or abort. */
async function waitForFirstPage(url, fetchImpl, signal) {
  const deadline = Date.now() + FIRST_PAGE_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(FIRST_PAGE_ATTEMPT_MS)]),
      });
      await response.arrayBuffer();
      return true;
    } catch {
      await sleep(FIRST_PAGE_RETRY_MS);
    }
  }
  return false;
}

function isAlive(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

/**
 * The pi-web server this app carries, run exactly as pi-web runs itself:
 * its own launcher (`bin/pi-web.js`) under a plain Node, which starts Next.js.
 *
 * The server never outlives the app, even an app that is killed: on Windows
 * Node starts its child processes in a job that closes with their parent,
 * which ends the launcher and, the same way, Next.js. scripts/verify.mjs kills
 * the app to check it.
 *
 * Emits `exit` when the server ends on its own after `start()` resolved.
 */
export class Backend extends EventEmitter {
  #options;
  #child = null;
  #stopping = false;
  #port = null;

  /** `http://host:port` of the running server; set by `start()`. */
  origin = null;
  /** The last lines the server printed, for the failure screen. */
  recentLines = [];

  /**
   * @param options.nodePath The Node binary to run the server with
   * @param options.serverDir The pi-web package directory (holds bin/, .next/, node_modules/)
   * @param options.env The server's environment
   * @param options.host Address to bind
   * @param options.preferredPort Port to ask for first; 0 for any
   * @param options.fetchImpl `fetch` used to tell when the first page is served
   * @param options.onLine Called with each line the server prints
   * @param options.log Called with what the shell itself has to say about the server
   */
  constructor(options) {
    super();
    this.#options = options;
  }

  get running() {
    return isAlive(this.#child);
  }

  /** The launcher's process id while it runs, else null. */
  get pid() {
    return this.running ? this.#child.pid : null;
  }

  /** Starts the server and resolves once it has served its first page. Rejects when it does not come up. */
  async start() {
    if (this.running) throw new Error("The server is already running");
    const { nodePath, serverDir, packaged, env, host, preferredPort, fetchImpl, log } = this.#options;
    if (packaged) prepareRouteCache(serverDir);
    const launcher = path.join(serverDir, "bin", "pi-web.js");

    if (!this.#port) {
      // A launcher killed along with the app (a crash, an update installed over the
      // running app) leaves the record `pi-web status` lists it by. Listing is what
      // drops such records, so pi-web is asked to list once per run of the app.
      spawn(nodePath, [launcher, "status"], { cwd: serverDir, env, stdio: "ignore", windowsHide: true }).on("error", () => {});
    }

    const wanted = this.#port ?? preferredPort;
    const port = await findPort({ previous: this.#port, preferred: preferredPort, host });
    if (!port) throw new Error(`No free port on ${host}`);
    if (wanted && port !== wanted) {
      log?.(`port ${wanted} is taken; using ${port}. The page keeps separate settings per port.`);
    }
    this.#port = port;
    this.#stopping = false;
    this.recentLines = [];
    this.origin = `http://${host}:${port}`;

    const child = spawn(nodePath, [launcher, "--port", String(port), "--hostname", host, "--no-open"], {
      cwd: serverDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    for (const stream of [child.stdout, child.stderr]) this.#readLines(stream);

    let ready = false;
    const startup = new AbortController();
    const failure = new Promise((resolve) => {
      child.once("error", (error) => {
        startup.abort();
        if (this.#child === child) this.#child = null;
        resolve(`could not be run (${nodePath}): ${error.message}`);
      });
      child.once("exit", (code, signal) => {
        startup.abort();
        if (this.#child === child) this.#child = null;
        // A launcher that was killed never got to remove its own record.
        this.#removeRunRecord(child.pid);
        resolve(`exited ${signal ? `on ${signal}` : `with code ${code}`}`);
        if (ready && !this.#stopping) this.emit("exit", { code, signal });
      });
    });

    const served = await Promise.race([waitForFirstPage(`${this.origin}/`, fetchImpl, startup.signal), failure]);
    if (served !== true) {
      this.stop();
      throw new Error(typeof served === "string" ? `The server ${served}` : "The server did not answer in time");
    }
    ready = true;
  }

  /** Ends the server and everything it started. Returns once the kill has been sent. */
  stop() {
    this.#stopping = true;
    const child = this.#child;
    if (!isAlive(child) || !child.pid) return;
    // The whole tree, as `pi-web stop` does on Windows: the launcher, Next.js, and the
    // shells and MCP servers under it.
    spawnSync(TASKKILL, ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    // When the app is quitting, it is gone before the launcher's exit is seen above.
    this.#removeRunRecord(child.pid);
  }

  /** Resolves once a stopped server's process is gone, or after timeoutMs. */
  whenStopped(timeoutMs = 8_000) {
    const child = this.#child;
    if (!isAlive(child)) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Removes the record `pi-web status` lists a launcher by (bin/run-records.js).
   * The launcher removes it itself when it exits; one that is killed cannot.
   */
  #removeRunRecord(pid) {
    const { serverDir, env, log } = this.#options;
    try {
      const records = createRequire(import.meta.url)(path.join(serverDir, "bin", "run-records.js"));
      records.removeRunRecord(records.getRunDir(env), pid);
    } catch (error) {
      // `pi-web status` drops a record whose process is gone.
      log?.(`could not remove the server's run record: ${error.message}`);
    }
  }

  #readLines(stream) {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) this.#line(line);
    });
    stream.on("end", () => {
      if (rest) this.#line(rest);
    });
  }

  #line(raw) {
    const line = raw.replace(ANSI_COLORS, "").trimEnd();
    if (!line) return;
    this.recentLines.push(line);
    if (this.recentLines.length > RECENT_LINES) this.recentLines.shift();
    this.#options.onLine?.(line);
  }
}
