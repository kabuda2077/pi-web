import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, screen, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Backend } from "./backend.mjs";
import { HOST, PREFERRED_PORT, profileDir, resolvePaths, selfTestDir, selfTestHold, selfTestScenario } from "./config.mjs";
import { revealFile, showFileMenu } from "./file-actions.mjs";
import { APP_ID } from "./identity.mjs";
import { isAppUrl, restorablePath } from "./links.mjs";
import { createLog } from "./log.mjs";
import { runSelfTest } from "./selftest.mjs";
import { createStore } from "./store.mjs";
import { stringsFor } from "./strings.mjs";
import { createTray } from "./tray.mjs";
import { createAppWindow, readPageTheme, trackWindowState } from "./window.mjs";
import { restoreBounds } from "./window-state.mjs";

// A window closed to the tray with nothing going on keeps its page this long,
// so reopening it right away is instant.
const RELEASE_AFTER_MS = 2 * 60_000;
// Until then, how often to look whether the hidden page has work to do.
const RELEASE_POLL_MS = 20_000;

// A server that keeps dying is not restarted forever.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

const STATUS_TIMEOUT_MS = 5_000;
const FAILURE_LOG_LINES = 25;
const PAGE_CRASH_RELOAD_GAP_MS = 10_000;
// Chromium's code for a load another load replaced; not a failure.
const ERR_ABORTED = -3;

// What the page uses (lib/browser-notifications.ts, lib/clipboard.ts, media previews).
// Everything else is refused: the file panel also shows HTML an agent wrote.
const PERMISSIONS = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"]);

const noop = () => {};

let paths;
let log = noop;
let store;
let t;
let backend;
let tray = null;
let mainWindow = null;
let windowContext;
let quitting = false;
let releaseTimer = null;
/** Counts up whenever the watch on a hidden page is replaced or called off. */
let releaseWatch = 0;
let focusRequests = 0;
// The menus and Explorer windows a self-test's page asked for: recorded, and never shown.
const fileRequests = selfTestDir ? [] : null;
let startAttempts = 0;
let recentExits = [];
let failureLog = "";
/** starting | restarting | ready | failed */
let serverState = "starting";

// Must come before anything reads the profile: the single-instance lock lives in it.
app.setPath("userData", profileDir());
// Windows files an app's notifications under this id. The installer's shortcut
// carries APP_ID; a run from source has no shortcut and is known by its executable.
app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

// Every open chat, terminal and watched file holds one long-lived stream, and
// Chromium allows a host six connections: past that, sending a message or
// opening Settings waits for a stream to close (pi-web docs/http2.md). The
// server is this machine's own, so the cap is lifted for it.
app.commandLine.appendSwitch("ignore-connections-limit", HOST);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // A second launch before this one finished starting has no window to raise yet.
    if (windowContext) showMainWindow();
  });
  // Closing the window leaves the server, and the tasks it runs, going in the tray.
  app.on("window-all-closed", noop);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    backend?.stop();
    store?.flush();
  });
  app.whenReady().then(start).catch(failToStart);
}

/**
 * An error while starting would leave the app running with no window and no
 * tray icon, holding the single-instance lock: every later launch would do nothing.
 */
function failToStart(error) {
  const message = String(error?.stack ?? error);
  log(`could not start: ${message}`);
  backend?.stop();
  if (!selfTestDir) dialog.showErrorBox(app.getName(), message);
  app.exit(1);
}

async function start() {
  paths = resolvePaths();
  const profile = app.getPath("userData");
  log = createLog(path.join(profile, "logs", "desktop.log"));
  store = createStore(path.join(profile, "state.json"));
  t = stringsFor(app.getLocale(), app.getName());
  log(
    `starting ${app.getName()} ${app.getVersion()} (electron ${process.versions.electron}, ` +
      `${app.isPackaged ? "installed" : "from source"}, server in ${paths.serverDir})`,
  );

  backend = new Backend({
    // The `server-fails` self-test names a Node binary that does not exist.
    nodePath: selfTestScenario === "server-fails" ? path.join(selfTestDir, "no-such-node.exe") : paths.nodePath,
    serverDir: paths.serverDir,
    packaged: app.isPackaged,
    env: serverEnvironment(),
    host: HOST,
    // A self-test may run while the app itself holds the usual port.
    preferredPort: selfTestDir ? 0 : PREFERRED_PORT,
    // Chromium's network stack never sends a loopback request through a proxy.
    fetchImpl: (url, init) => net.fetch(url, init),
    onLine: createLog(path.join(profile, "logs", "server.log")),
    log,
  });
  backend.on("exit", onServerExit);

  windowContext = {
    origin: () => backend.origin,
    strings: t,
    log,
    devTools: !app.isPackaged,
    icon: app.isPackaged ? undefined : paths.iconPath,
    backgroundColor: () => store.get("theme")?.bg ?? (nativeTheme.shouldUseDarkColors ? "#1a1a1a" : "#ffffff"),
    record: fileRequests,
  };

  Menu.setApplicationMenu(shortcutMenu());
  restrictPermissions(session.defaultSession);
  listenToPages();
  // The page gets no service worker here (src/preload.cjs); one an earlier build left must not serve it either.
  await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }).catch(noop);

  // A self-test stays off the screen: no tray icon, and its windows are never shown.
  if (!selfTestDir) {
    tray = createTray({
      iconPath: paths.iconPath,
      tooltip: app.getName(),
      strings: t,
      actions: {
        show: showMainWindow,
        restartServer: () => void restartServer({ confirm: true }),
        openLogs: () => void shell.openPath(path.join(profile, "logs")),
        quit: () => void quitFromTray(),
      },
    });
  }

  openMainWindow();
  await startServer();

  if (selfTestDir) await finishSelfTest();
}

async function finishSelfTest() {
  const passed = await runSelfTest({
    dir: selfTestDir,
    scenario: selfTestScenario,
    log,
    backend,
    mainWindow: () => mainWindow,
    serverState: () => serverState,
    startAttempts: () => startAttempts,
    focusRequests: () => focusRequests,
    fileRequests: () => fileRequests,
    closeWindow: () => mainWindow?.close(),
    releasePage: () => mainWindow && releasePage(mainWindow),
    showWindow: showMainWindow,
    pageStillNeeded,
  });
  if (selfTestHold) return;
  quitting = true;
  backend.stop();
  await backend.whenStopped();
  store.flush();
  app.exit(passed ? 0 : 1);
}

/**
 * The server's environment is the user's own, as when pi-web starts from a
 * terminal: the agent's tools must find the same PATH, proxy and credentials.
 */
function serverEnvironment() {
  const env = { ...process.env };
  // A self-test never touches the user's sessions or settings.
  if (selfTestDir) env.PI_CODING_AGENT_DIR = path.join(selfTestDir, "agent");
  if (app.isPackaged) {
    // pi installs plugins with `npm` from PATH. A machine without Node.js finds
    // the one this app carries; one with Node.js keeps using its own, which comes first.
    const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
    env[key] = [env[key], path.dirname(paths.nodePath)].filter(Boolean).join(path.delimiter);
  }
  return env;
}

/** Shortcuts a browser would give. The bar itself is hidden on every window. */
function shortcutMenu() {
  return Menu.buildFromTemplate([
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "reload", accelerator: "F5" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomIn", accelerator: "CommandOrControl+=" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
        { role: "toggleDevTools", accelerator: "F12" },
      ],
    },
  ]);
}

function restrictPermissions(ses) {
  const allowed = (permission, url) => PERMISSIONS.has(permission) && isAppUrl(url, backend.origin);
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details.requestingUrl || webContents.getURL();
    const grant = allowed(permission, url);
    if (!grant) log(`refused the "${permission}" permission to ${url.slice(0, 200)}`);
    callback(grant);
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => allowed(permission, requestingOrigin));
}

/** What a page may ask of the shell (src/preload.cjs). */
function listenToPages() {
  const loadingPageUrl = pathToFileURL(paths.loadingPage).href;

  // The buttons of the shell's own loading page.
  ipcMain.on("pi-desktop:action", (event, action) => {
    if (!event.senderFrame?.url.startsWith(loadingPageUrl)) return;
    if (action === "retry") void restartServer();
    else if (action === "logs") void shell.openPath(path.join(app.getPath("userData"), "logs"));
    else if (action === "quit") app.quit();
  });

  // pi-web's window.focus(), called when its notification is clicked.
  ipcMain.on("pi-desktop:focus-window", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !isAppUrl(event.senderFrame?.url ?? "", backend.origin)) return;
    focusRequests += 1;
    if (win === mainWindow) showMainWindow();
    else reveal(win);
  });

  // A file of this computer that pi-web's page names: the file panel's
  // "Show in Explorer" button and the menu of a file link in the chat.
  const fromAppPage = (event) => isAppUrl(event.senderFrame?.url ?? "", backend.origin);
  const ownsCaption = (event) => mainWindow && event.sender === mainWindow.webContents && event.senderFrame === event.sender.mainFrame &&
    (fromAppPage(event) || event.senderFrame.url.split("?")[0] === loadingPageUrl);
  ipcMain.handle("pi-desktop:window-state", event => ownsCaption(event) ? captionState(mainWindow) : null);
  ipcMain.on("pi-desktop:window-action", (event, action) => {
    if (!ownsCaption(event)) return;
    if (action === "minimize") mainWindow.minimize();
    else if (action === "toggle-maximize") {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === "close") mainWindow.close(); // Same close-to-tray path as Alt+F4.
  });
  const fileActions = { strings: t, log, record: fileRequests };
  ipcMain.handle("pi-desktop:reveal-file", (event, filePath) => fromAppPage(event) && revealFile(filePath, fileActions));
  ipcMain.handle("pi-desktop:file-menu", (event, request) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && fromAppPage(event) ? showFileMenu(win, request, fileActions) : null;
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function startServer() {
  startAttempts += 1;
  const startedAt = Date.now();
  try {
    await backend.start();
  } catch (error) {
    serverState = "failed";
    failureLog = [error.message, ...backend.recentLines.slice(-FAILURE_LOG_LINES)].join("\n");
    log(`server failed to start: ${error.message}`);
    showLoading(mainWindow);
    return;
  }
  serverState = "ready";
  log(`server ready at ${backend.origin} after ${Date.now() - startedAt} ms`);

  for (const win of BrowserWindow.getAllWindows()) {
    if (win === mainWindow) win.loadURL(appUrl()).catch(noop);
    // A second window survives a restart only if its address still exists.
    else if (isAppUrl(win.webContents.getURL(), backend.origin)) win.reload();
    else win.close();
  }
}

function onServerExit({ code, signal }) {
  if (quitting) return;
  log(`server ended on its own (${signal ?? `code ${code}`})`);
  const now = Date.now();
  recentExits = [...recentExits.filter((at) => now - at < RESTART_WINDOW_MS), now];
  if (recentExits.length > MAX_RESTARTS) {
    serverState = "failed";
    failureLog = backend.recentLines.slice(-FAILURE_LOG_LINES).join("\n");
    showLoading(mainWindow);
    return;
  }
  serverState = "restarting";
  showLoading(mainWindow);
  void startServer();
}

async function restartServer({ confirm = false } = {}) {
  if (serverState === "starting" || serverState === "restarting") return;
  if (confirm && (await tasksRunning()) && !confirmInterrupt(t.restartAnyway, t.interruptDetailRestart)) return;
  // After a failed start there is nothing running to restart: it is a plain start.
  serverState = serverState === "failed" ? "starting" : "restarting";
  recentExits = [];
  showLoading(mainWindow);
  backend.stop();
  await backend.whenStopped();
  await startServer();
}

async function serverJson(pathname) {
  const response = await net.fetch(`${backend.origin}${pathname}`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Whether an agent run is in progress, which quitting or restarting would cut off. */
async function tasksRunning() {
  if (serverState !== "ready") return false;
  try {
    const status = await serverJson("/api/agent/running");
    return [status.runningSessionIds, status.subagentsActiveSessionIds].some((ids) => Array.isArray(ids) && ids.length > 0);
  } catch {
    return false;
  }
}

/**
 * Whether a hidden page has work to do, and so must stay loaded:
 * - a run in progress or a dialog waiting for an answer: the page plays the
 *   completion sound and shows the notification;
 * - an open terminal: pi-web ends a shell 2 minutes after its last page
 *   disconnects (`TERMINAL_RECONNECT_MS`).
 *
 * Any answer that cannot be read counts as yes: a page kept too long costs
 * memory, a page dropped too early costs the user a running command.
 */
async function pageStillNeeded() {
  if (serverState !== "ready") return true;
  try {
    const [status, debug] = await Promise.all([serverJson("/api/agent/running"), serverJson("/api/agent/debug")]);
    const sessions = [status.runningSessionIds, status.awaitingInputSessionIds, status.subagentsActiveSessionIds];
    if (sessions.some((ids) => !Array.isArray(ids) || ids.length > 0)) return true;
    const terminals = debug?.server?.terminals?.count;
    return typeof terminals !== "number" || terminals > 0;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function appUrl() {
  const lastPath = store.get("lastPath");
  return `${backend.origin}${typeof lastPath === "string" && lastPath.startsWith("/") ? lastPath : "/"}`;
}

function reveal(win) {
  if (selfTestDir) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function captionState(win) {
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
}

function openMainWindow() {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const { maximized, ...bounds } = restoreBounds(store.get("window"), workAreas);
  const win = createAppWindow(bounds, windowContext);
  mainWindow = win;
  for (const event of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(event, () => { if (!win.webContents.isDestroyed()) win.webContents.send("pi-desktop:window-state", captionState(win)); });
  }
  trackWindowState(win, bounds, (state) => store.set("window", state));

  win.once("ready-to-show", () => {
    if (maximized && !selfTestDir) win.maximize();
    reveal(win);
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideMainWindow();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on("blur", () => void rememberTheme(win));

  const webContents = win.webContents;
  webContents.on("did-navigate", (_event, url) => rememberPath(url));
  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) rememberPath(url);
  });
  webContents.on("did-finish-load", () => void rememberTheme(win));
  webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== ERR_ABORTED) log(`page failed to load (${code} ${description}): ${url}`);
  });
  let lastPageCrashAt = 0;
  webContents.on("render-process-gone", (_event, details) => {
    log(`the page's process ended (${details.reason})`);
    // Reload a crashed page once; one that crashes straight away again is left for Ctrl+R.
    const crashedAgain = Date.now() - lastPageCrashAt < PAGE_CRASH_RELOAD_GAP_MS;
    lastPageCrashAt = Date.now();
    if (details.reason !== "clean-exit" && !crashedAgain && !win.isDestroyed()) showCurrentPage(win);
  });

  showCurrentPage(win);
}

function showCurrentPage(win) {
  if (serverState === "ready") win.loadURL(appUrl()).catch(noop);
  else showLoading(win);
}

/** Shows the shell's own page for a server that is not serving: starting, restarting or failed. */
function showLoading(win) {
  if (!win || win.isDestroyed()) return;
  const theme = store.get("theme");
  const state = {
    title: app.getName(),
    icon: pathToFileURL(paths.iconPath).href,
    bg: theme?.bg,
    dark: theme?.dark,
    phase: serverState,
    status: serverState === "restarting" ? t.restarting : t.starting,
    failedTitle: t.failedTitle,
    failedHint: t.failedHint,
    log: serverState === "failed" ? failureLog : "",
    retry: t.retry,
    openLogs: t.openLogs,
    quit: t.quit,
  };
  const webContents = win.webContents;
  const onLoadingPage = webContents.getURL().startsWith(pathToFileURL(paths.loadingPage).href);
  if (onLoadingPage && !webContents.isLoading()) {
    webContents.executeJavaScript(`window.piDesktop.show(${JSON.stringify(state)})`).catch(noop);
  } else {
    win.loadFile(paths.loadingPage, { query: { state: JSON.stringify(state) } }).catch(noop);
  }
}

function rememberPath(url) {
  const pagePath = restorablePath(url, backend.origin);
  if (pagePath) store.set("lastPath", pagePath);
}

async function rememberTheme(win) {
  if (win.isDestroyed() || !isAppUrl(win.webContents.getURL(), backend.origin)) return;
  const theme = await readPageTheme(win.webContents);
  if (!theme || win.isDestroyed()) return;
  store.set("theme", theme);
  win.setBackgroundColor(theme.bg);
}

function showMainWindow() {
  cancelRelease();
  if (!mainWindow || mainWindow.isDestroyed()) {
    openMainWindow();
    return;
  }
  reveal(mainWindow);
}

function hideMainWindow() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  rememberPath(win.webContents.getURL());
  win.hide();
  if (tray && !store.get("trayHintShown")) {
    store.set("trayHintShown", true);
    tray.displayBalloon({ iconType: "info", title: t.trayHintTitle, content: t.trayHintBody });
  }
  watchHiddenPage(win);
}

// ---------------------------------------------------------------------------
// Releasing a hidden page
//
// The page is a large share of the app's memory, and while it is loaded it
// keeps renewing its session's lease, which keeps that session and its MCP
// servers alive too. A window closed to the tray with nothing going on gives
// both back, as closing a browser tab does; opening the window again loads
// the page where it was.
//
// A page found with work to do while hidden is kept until its window is shown
// again: it announces the finished task, and that notification lives in the page.
// ---------------------------------------------------------------------------

function cancelRelease() {
  releaseWatch += 1;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
}

function watchHiddenPage(win) {
  cancelRelease();
  const watch = releaseWatch;
  const hiddenAt = Date.now();
  const current = () => watch === releaseWatch && mainWindow === win && !win.isDestroyed() && !win.isVisible();

  const check = async () => {
    releaseTimer = null;
    if (!current() || (await pageStillNeeded()) || !current()) return;
    if (Date.now() - hiddenAt >= RELEASE_AFTER_MS) releasePage(win);
    else releaseTimer = setTimeout(check, RELEASE_POLL_MS);
  };
  void check();
}

function releasePage(win) {
  log("releasing the hidden window's page");
  rememberPath(win.webContents.getURL());
  // destroy(), not close(): close is what hides the window to the tray.
  win.destroy();
}

// ---------------------------------------------------------------------------
// Quitting
// ---------------------------------------------------------------------------

function confirmInterrupt(proceedLabel, detail) {
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    message: t.interruptMessage,
    detail,
    buttons: [proceedLabel, t.cancel],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return choice === 0;
}

async function quitFromTray() {
  if ((await tasksRunning()) && !confirmInterrupt(t.quitAnyway, t.interruptDetailQuit)) return;
  app.quit();
}
