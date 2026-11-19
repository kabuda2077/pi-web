import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { isAppUrl } from "./links.mjs";

// `--self-test=<dir>` starts the app on a throwaway profile and agent
// directory, checks that the packaged pieces work together, writes
// <dir>/report.json and <dir>/screenshot.png, and exits 0 or 1. Nothing shows
// on screen, no message goes to a model, and the user's sessions are never read.

const OVERALL_TIMEOUT_MS = 180_000;
const PAGE_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 15_000;
const PAGE_EXIT_TIMEOUT_MS = 15_000;
const RESTART_TIMEOUT_MS = 60_000;
const FAILURE_TIMEOUT_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await Promise.resolve().then(check).catch(() => null);
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

/**
 * The main window once it shows the rendered pi-web page; null on timeout.
 * A fresh agent directory has no project yet, so the page is the "get started"
 * screen and not a chat: only the title and some rendered text are asked for.
 */
function pageReady(shell) {
  return waitFor(async () => {
    const win = shell.mainWindow();
    if (!win || win.isDestroyed()) return null;
    const webContents = win.webContents;
    if (webContents.isLoading() || !isAppUrl(webContents.getURL(), shell.backend.origin)) return null;
    const rendered = await webContents.executeJavaScript(
      "document.title.includes('Pi Web') && document.body.innerText.trim().length > 20",
      true,
    );
    return rendered ? win : null;
  }, PAGE_TIMEOUT_MS);
}

/** Saves what the window shows as <dir>/screenshot.png. A window that has not painted yet is asked again. */
async function saveScreenshot(win, dir, name = "screenshot.png") {
  const image = await waitFor(async () => {
    const captured = await win.webContents.capturePage();
    return captured.isEmpty() ? null : captured;
  }, SCREENSHOT_TIMEOUT_MS, 500);
  if (image) fs.writeFileSync(path.join(dir, name), image.toPNG());
  return image?.getSize() ?? null;
}

/** What the main window shows right now, for a report on a page that never became ready. */
async function describeWindow(shell) {
  const win = shell.mainWindow();
  if (!win || win.isDestroyed()) return { window: "none" };
  const webContents = win.webContents;
  const seen = { url: webContents.getURL(), loading: webContents.isLoading(), title: webContents.getTitle() };
  try {
    seen.text = (await webContents.executeJavaScript("document.body.innerText.slice(0, 400)", true)) ?? "";
    await saveScreenshot(win, shell.dir);
  } catch (error) {
    seen.error = String(error);
  }
  return seen;
}

/** The app's own processes with their private memory in MB. The server is not among them. */
function ownProcesses() {
  return app.getAppMetrics().map((metric) => ({
    kind: metric.type === "Utility" ? (metric.serviceName ?? metric.name ?? "Utility") : metric.type,
    pid: metric.pid,
    megabytes: Math.round((metric.memory.privateBytes ?? 0) / 102.4) / 10,
  }));
}

/**
 * Runs inside the page, so every request goes through Chromium as the page's
 * own do. Serialized with toString(): it must not close over anything.
 */
async function pageProbe({ cwd }) {
  const STREAMS = 12;
  const json = async (url, init) => {
    const response = await fetch(url, init);
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: the status is the answer.
    }
    return { status: response.status, body };
  };
  const post = (url, body) =>
    json(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const out = {
    title: document.title,
    language: navigator.language,
    userAgent: navigator.userAgent,
    theme: document.documentElement.dataset.theme ?? null,
    notifications: Notification.permission,
    serviceWorker: "serviceWorker" in navigator,
    pdfViewer: navigator.pdfViewerEnabled,
    home: (await json("/api/home")).status,
    sessions: (await json("/api/sessions")).status,
  };
  // What pi-web does when its notification is clicked.
  window.focus();

  // Starts an agent session without sending anything: the pi SDK has to load and build one.
  const agent = await post("/api/agent/new", { cwd, type: "ensure_session" });
  out.agent = { status: agent.status, sessionId: agent.body?.sessionId ?? null, error: agent.body?.error ?? null };

  const terminal = await post("/api/terminal", { cwd, cols: 80, rows: 24 });
  out.terminal = { status: terminal.status, error: terminal.body?.error ?? null, shellOutput: false };
  const id = terminal.body?.id;
  if (!id) return out;
  const events = `/api/terminal/${id}/events`;

  // The shell printed something once an event carries a non-zero offset.
  const reading = new AbortController();
  const readTimer = setTimeout(() => reading.abort(), 12000);
  try {
    const response = await fetch(events, { signal: reading.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!out.terminal.shellOutput) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
      out.terminal.shellOutput = /"offset":[1-9]/.test(received);
    }
  } catch {
    // Timed out: shellOutput stays false.
  }
  clearTimeout(readTimer);
  reading.abort();

  // Chromium gives a host six connections unless the app lifted the cap.
  const streams = Array.from({ length: STREAMS }, () => {
    const controller = new AbortController();
    const opened = fetch(events, { signal: controller.signal }).then(
      (response) => response.status === 200,
      () => false,
    );
    return { controller, opened };
  });
  const settled = await Promise.all(
    streams.map(({ opened }) => Promise.race([opened, new Promise((resolve) => setTimeout(() => resolve(false), 6000))])),
  );
  out.streams = { asked: STREAMS, opened: settled.filter(Boolean).length };
  for (const { controller } of streams) controller.abort();

  out.terminal.closed = (await json(`/api/terminal/${id}`, { method: "DELETE" })).status;
  return out;
}

const LINK_TEXT = "the report";
const SESSION_ID = "0199c0de-0000-7000-8000-00000000f11e";

/**
 * A session whose reply links a file of its folder the way a model writes one:
 * relative to the session's cwd. Written as pi writes its session files, so no
 * message goes to a model.
 *
 * @returns The file the link names
 */
function writeLinkedFileSession(shell, workDir) {
  const filePath = path.join(workDir, "notes", "the report.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "# Report\n");

  const at = new Date();
  const stamp = at.toISOString();
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const entries = [
    { type: "session", version: 3, id: SESSION_ID, timestamp: stamp, cwd: workDir },
    { type: "message", id: "a0000001", parentId: null, timestamp: stamp, message: { role: "user", content: [{ type: "text", text: "Write the report." }], timestamp: at.getTime() } },
    {
      type: "message",
      id: "a0000002",
      parentId: "a0000001",
      timestamp: stamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: `Saved [${LINK_TEXT}](notes/the%20report.md).` }],
        api: "openai-responses",
        provider: "self-test",
        model: "self-test",
        usage,
        stopReason: "stop",
        timestamp: at.getTime(),
      },
    },
  ];
  const sessionDir = path.join(shell.dir, "agent", "sessions", `--${workDir.replace(/[\\/:]/g, "-")}--`);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, `${stamp.replace(/[:.]/g, "-")}_${SESSION_ID}.jsonl`),
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  return filePath;
}

/** A click of a mouse button at a point of the page, as the user's own. */
function click(webContents, { x, y }, button) {
  webContents.sendInputEvent({ type: "mouseMove", x, y });
  webContents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
  webContents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 1 });
}

/**
 * The two things pi-web's page asks the shell for a file (lib/desktop-host.ts):
 * the menu of a file link in the chat, and the file panel's "Show in Explorer"
 * button. Both end in the shell's record instead of on screen.
 */
async function probeFileActions(shell, win, workDir, check) {
  const filePath = writeLinkedFileSession(shell, workDir);
  const samePath = (value) => typeof value === "string" && value.toLowerCase() === filePath.toLowerCase();
  const requests = shell.fileRequests();
  const webContents = win.webContents;
  const run = (source) => webContents.executeJavaScript(source, true);
  const center = `((el) => { const box = el.getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })`;

  await webContents.loadURL(`${shell.backend.origin}/?session=${SESSION_ID}`);
  const link = await waitFor(
    () => run(`(() => { const a = [...document.querySelectorAll("a")].find((el) => el.textContent === ${JSON.stringify(LINK_TEXT)}); return a ? ${center}(a) : null; })()`),
    PAGE_TIMEOUT_MS,
  );
  check("a session's reply shows its file link", link, link ? undefined : await describeWindow(shell));
  if (!link) return;

  // The user's own message is no file link: the page's usual menu, as before.
  const plain = await run(`(() => { const el = [...document.querySelectorAll("p, div, span")].reverse().find((node) => node.textContent === "Write the report."); return el ? ${center}(el) : null; })()`);
  check("the session shows the user's message", plain);
  if (plain) {
    click(webContents, plain, "right");
    check("right-click elsewhere asks for the usual menu", await waitFor(() => requests.some((entry) => entry.action === "page-menu"), 5000), [...requests]);
  }
  requests.length = 0;

  click(webContents, link, "right");
  const menu = await waitFor(() => requests.find((entry) => entry.action === "menu"), 5000);
  check("right-click on a file link asks for the file menu", menu, [...requests]);
  check("the file menu names the file by its full path", samePath(menu?.filePath), { asked: menu?.filePath, file: filePath });
  check("the file menu offers Open, Show in Explorer and Copy path", menu?.items.length === 3 && menu.items.every((item) => item.enabled), menu?.items);
  check("the usual menu stays away from a file link", !requests.some((entry) => entry.action === "page-menu"), [...requests]);

  // The self-test's menu answers Open: the file panel opens on the file.
  const button = await waitFor(
    () => run(`(() => {
      const download = document.querySelector("#file-panel a[download]");
      const before = download?.previousElementSibling;
      if (before?.tagName !== "BUTTON" || !before.title) return null;
      const box = (el) => { const { x, y, width, height } = el.getBoundingClientRect(); return [x, y, width, height].map(Math.round); };
      return { title: before.title, download: download.getAttribute("download"), button: box(before), link: box(download), panel: box(document.querySelector("#file-panel")), window: [innerWidth, innerHeight] };
    })()`),
    PAGE_TIMEOUT_MS,
  );
  check("Open in the file menu opens the file panel", button?.download === path.basename(filePath), button);
  check("the file panel has a button left of Download", button?.title, button);
  if (!button) return;
  // A hidden window paints late: the picture is taken once the panel is in it.
  webContents.invalidate();
  await sleep(1500);
  await saveScreenshot(win, shell.dir, "file-panel.png");

  requests.length = 0;
  await run(`document.querySelector("#file-panel a[download]").previousElementSibling.click()`);
  const reveal = await waitFor(() => requests.find((entry) => entry.action === "reveal"), 5000);
  check("the button shows the file in Explorer", samePath(reveal?.select), { asked: reveal, file: filePath });
}

/** The `server-fails` scenario: the server cannot start, and the window must say so and offer a way on. */
async function probeFailure(shell, report, check) {
  const failed = await waitFor(() => shell.serverState() === "failed", FAILURE_TIMEOUT_MS);
  check("a server that cannot start is reported as failed", failed);
  const win = shell.mainWindow();
  const readPage = () =>
    win.webContents.executeJavaScript(
      `({
        phase: document.body.dataset.phase,
        title: document.getElementById("failed-title").textContent,
        log: document.getElementById("log").textContent,
        buttons: [...document.querySelectorAll("button")].map((button) => button.offsetParent !== null && button.textContent),
      })`,
      true,
    );
  const page = await waitFor(async () => {
    const state = await readPage();
    return state.phase === "failed" ? state : null;
  }, FAILURE_TIMEOUT_MS);
  report.page = page;
  check("the window shows the failure page", page?.title);
  check("the failure page says what went wrong", page?.log.includes("could not be run"), page?.log.slice(0, 300));
  check("the failure page offers retry, logs and quit", page?.buttons.length === 3 && page.buttons.every(Boolean), page?.buttons);
  await saveScreenshot(win, shell.dir);

  const attempts = shell.startAttempts();
  await win.webContents.executeJavaScript(`document.getElementById("retry").click()`, true);
  check("Retry starts the server again", await waitFor(() => shell.startAttempts() === attempts + 1, FAILURE_TIMEOUT_MS));
}

async function probe(shell, report) {
  const check = (name, ok, detail) => {
    report.checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  };
  if (shell.scenario === "server-fails") return probeFailure(shell, report, check);

  const { backend } = shell;
  const workDir = path.join(shell.dir, "work");
  fs.mkdirSync(workDir, { recursive: true });

  check("server is running", backend.running, backend.origin);
  const win = await pageReady(shell);
  check("the page rendered", win, win ? undefined : await describeWindow(shell));
  if (!win) return;
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") report.consoleErrors.push(event.message);
  });

  const focusRequestsBefore = shell.focusRequests();
  const page = await win.webContents.executeJavaScript(`(${pageProbe})(${JSON.stringify({ cwd: workDir })})`, true);
  report.page = page;
  check("GET /api/home", page.home === 200, page.home);
  check("GET /api/sessions", page.sessions === 200, page.sessions);
  check("agent session starts (the pi SDK loads)", page.agent.status === 200 && page.agent.sessionId, page.agent);
  check("terminal runs a shell (node-pty loads)", page.terminal.status === 200 && page.terminal.shellOutput, page.terminal);
  check("more than six streams open at once", page.streams?.opened === page.streams?.asked, page.streams);
  check("notifications are allowed", page.notifications === "granted", page.notifications);
  check("the page has no service worker to send notifications through", page.serviceWorker === false);
  check("a notification click reaches the shell", shell.focusRequests() === focusRequestsBefore + 1);
  check("the PDF viewer is on", page.pdfViewer === true, page.pdfViewer);

  check("screenshot captured", await saveScreenshot(win, shell.dir));
  report.processes = { withPage: ownProcesses() };
  report.serverPids = serverPids(shell);

  // Closing to the tray, giving the page back, and opening the window again.
  const idle = await waitFor(async () => !(await shell.pageStillNeeded()), IDLE_TIMEOUT_MS, 500);
  check("an idle server lets a hidden page go", idle);
  const pagePid = win.webContents.getOSProcessId();
  shell.closeWindow();
  check("closing keeps the window for the tray", !win.isDestroyed() && !win.isVisible() && shell.mainWindow() === win);
  shell.releasePage();
  check("the hidden page is released", win.isDestroyed() && shell.mainWindow() === null);
  const pageProcessEnded = await waitFor(() => !ownProcesses().some((entry) => entry.pid === pagePid), PAGE_EXIT_TIMEOUT_MS);
  check("the released page's process ends", pageProcessEnded, { pid: pagePid });
  report.processes.released = ownProcesses();
  shell.showWindow();
  const reopened = await pageReady(shell);
  check("the window reopens on the page", reopened && reopened !== win);

  // The launcher dies and leaves Next.js serving: the app must end that one and
  // come back on the same address, or the page would lose its storage.
  const origin = backend.origin;
  const launcherPid = backend.pid;
  process.kill(launcherPid, "SIGKILL");
  const restarted = await waitFor(
    () => shell.serverState() === "ready" && backend.running && backend.pid !== launcherPid,
    RESTART_TIMEOUT_MS,
  );
  check("the server restarts after its launcher is killed", restarted);
  check("the restarted server has the same address", backend.origin === origin, { before: origin, after: backend.origin });
  const reloaded = await pageReady(shell);
  check("the page reloads after the restart", reloaded);
  report.serverPids.push(...serverPids(shell));

  if (reloaded) await probeFileActions(shell, reloaded, workDir, check);
}

/** The running server's launcher and Next.js process ids, the second from pi-web's own run record. */
function serverPids(shell) {
  const launcher = shell.backend.pid;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(shell.dir, "agent", "pi-web-run", `${launcher}.json`), "utf8"));
    return [launcher, record.nextPid];
  } catch {
    return [launcher];
  }
}

/**
 * @param shell dir, scenario, log, backend, mainWindow(), serverState(), startAttempts(), focusRequests(),
 *   fileRequests(), closeWindow(), releasePage(), showWindow(), pageStillNeeded()
 * @returns Whether every check passed
 */
export async function runSelfTest(shell) {
  const report = {
    ok: false,
    scenario: shell.scenario,
    startedAt: new Date().toISOString(),
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome },
    origin: shell.backend.origin,
    checks: [],
    consoleErrors: [],
  };
  try {
    const finished = await Promise.race([
      probe(shell, report).then(() => true),
      sleep(OVERALL_TIMEOUT_MS).then(() => false),
    ]);
    if (!finished) report.checks.push({ name: "finished in time", ok: false });
    report.ok = report.checks.length > 0 && report.checks.every((entry) => entry.ok);
  } catch (error) {
    report.error = String(error?.stack ?? error);
  }
  report.serverLog = shell.backend.recentLines;
  fs.writeFileSync(path.join(shell.dir, "report.json"), JSON.stringify(report, null, 2));
  shell.log(`self-test ${report.ok ? "passed" : "FAILED"}`);
  return report.ok;
}
