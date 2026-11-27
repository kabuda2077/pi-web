import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
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

/** Captures the actual compositor output. A window that has not painted yet is asked again. */
function capture(win, rect) {
  return waitFor(async () => {
    const captured = await win.webContents.capturePage(rect);
    return captured.isEmpty() ? null : captured;
  }, SCREENSHOT_TIMEOUT_MS, 500);
}

async function saveScreenshot(win, dir, name = "screenshot.png") {
  const image = await capture(win);
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
const NAV_SESSION_ID = "0199c0de-0000-7000-8000-000000000a11";

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

  writeFixtureSession(shell, workDir, SESSION_ID, [["Write the report.", `Saved [${LINK_TEXT}](notes/the%20report.md).`]]);
  return filePath;
}

function writeFixtureSession(shell, workDir, sessionId, turns) {
  // The crash scenario reopens the same work directory: keep one file per fixture ID.
  const at = fs.statSync(workDir).birthtime;
  const stamp = at.toISOString();
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const entries = [{ type: "session", version: 3, id: sessionId, timestamp: stamp, cwd: workDir }];
  let parentId = null;
  const add = (text, message) => {
    const id = entries.length.toString(16).padStart(8, "0");
    entries.push({ type: "message", id, parentId, timestamp: stamp, message: { ...message, content: [{ type: "text", text }], timestamp: at.getTime() } });
    parentId = id;
    return id;
  };
  const userIds = turns.map(([prompt, reply]) => {
    const id = add(prompt, { role: "user" });
    add(reply, { role: "assistant", api: "openai-responses", provider: "self-test", model: "self-test", usage, stopReason: "stop" });
    return id;
  });
  const sessionDir = path.join(shell.dir, "agent", "sessions", `--${workDir.replace(/[\\/:]/g, "-")}--`);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, `${stamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`),
    entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  return userIds;
}

/** A click of a mouse button at a point of the page, as the user's own. */
function click(webContents, { x, y }, button) {
  webContents.sendInputEvent({ type: "mouseMove", x, y });
  webContents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
  webContents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount: 1 });
}

// Serialized into the renderer. Measure visible targets, not inactive copies in the other bar.
function captionState(panelOpen) {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && r.width > 0 && r.height > 0 &&
      r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  };
  const region = (el) => getComputedStyle(el).getPropertyValue("-webkit-app-region");
  const box = (el) => el.getBoundingClientRect().toJSON();
  const groups = [...document.querySelectorAll("[data-window-controls]")].filter(visible).map(el => ({
    box: box(el), buttons: [...el.querySelectorAll("button")].filter(visible).map(b => ({
      action: b.dataset.windowAction, maximized: b.dataset.maximized, region: region(b), box: box(b),
    })),
  }));
  const bars = (panelOpen ? ["center", "panel"] : ["center"]).map((name) => {
    const bar = document.querySelector(`[data-desktop-bar="${name}"]`);
    if (!bar) return { name };
    const controls = [...bar.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(visible);
    const toggle = controls.find((el) => el.matches('button[aria-controls="file-panel"][aria-expanded]'));
    return { name, box: box(bar), region: region(bar), border: getComputedStyle(bar).borderBottomColor,
      toggle: toggle && box(toggle), toggleFill: toggle && getComputedStyle(toggle).backgroundColor,
      expanded: toggle?.ariaExpanded, controls: controls.map(region) };
  });
  return { width: innerWidth, dpr: devicePixelRatio, groups, bars };
}

// Inspect the same crop we save. Either the bar or a separate fixed group can paint the divider.
function captionDivider(png, rect, bar) {
  const image = nativeImage.createFromBuffer(png); // Read PNG pixels at 1x regardless of monitor DPI.
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA on Windows.
  const rgb = css => css?.match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1).map(Number);
  const pixel = (x, y) => {
    const i = (y * width + x) * 4;
    return [bitmap[i + 2], bitmap[i + 1], bitmap[i]];
  };
  const matches = (actual, expected) => expected && expected.every((v, i) => Math.abs(actual[i] - v) <= 5);
  const border = rgb(bar.border);
  if (!border || !bar.toggle || !bar.box) return { ok: false, reason: "missing border or toggle geometry" };
  const sx = width / rect.width, sy = height / rect.height;
  const from = Math.max(0, Math.floor((bar.toggle.left - rect.x) * sx));
  const bottom = (bar.box.bottom - rect.y) * sy;
  // The DOM can be open while a hidden window still returns an older toolbar.
  // Sample inside the selected toggle, clear of its icon and borders, in this same frame.
  const fill = bar.expanded === "true" ? {
    expected: rgb(bar.toggleFill), actual: pixel(Math.floor((bar.toggle.left - rect.x + 4) * sx), Math.floor((bar.toggle.top - rect.y + 4) * sy)),
  } : null;
  let best;
  for (let y = Math.max(0, Math.floor(bottom - sy) - 1); y <= Math.min(height - 1, Math.ceil(bottom)); y++) {
    let missing = 0, firstGap = null;
    for (let x = from; x < width; x++) {
      const actual = pixel(x, y);
      if (matches(actual, border)) continue;
      missing++;
      firstGap ??= { x, actual };
    }
    if (!best || missing < best.missing) best = { y, missing, firstGap };
  }
  return { ok: from < width && best?.missing === 0 && (!fill || !!matches(fill.actual, fill.expected)),
    width, height, from, to: width - 1, best, fill };
}

async function checkCaption(win, dir, run, panelOpen, check) {
  const read = () => run(`(${captionState})(${panelOpen})`);
  const state = await waitFor(async () => {
    const s = await read();
    return s.groups.length && s.bars.at(-1).expanded === String(panelOpen) && s;
  }, 3000) || await read();
  const { groups, bars } = state;
  const bar = bars.at(-1);
  const group = groups[0];
  const buttons = group?.buttons ?? [];
  const near = (a, b) => Math.abs(a - b) <= 1 / state.dpr;
  const phase = panelOpen ? "panel open" : "panel closed";
  check(`one visible minimize/maximize/close group (${phase})`, groups.length === 1 &&
    buttons.map(b => b.action).join() === "minimize,toggle-maximize,close" &&
    buttons[1].maximized === String(win.isMaximized()), state);
  check(`compact contiguous buttons reach the right edge (${phase})`, buttons.length === 3 &&
    buttons.every(({ box }, i) => near(box.width, 42) && box.height >= 24 && box.bottom <= 36 + 1 / state.dpr &&
      near(box.top, buttons[0].box.top) && near(box.left, i ? buttons[i - 1].box.right : group.box.left)) &&
    near(buttons.at(-1).box.right, state.width) && near(group.box.right, state.width), group);
  check(`file panel toggle is next to minimize (${phase})`, bar.expanded === String(panelOpen) && buttons.length &&
    near(bar.toggle?.right, buttons[0].box.left) && Math.abs((bar.toggle.top + bar.toggle.bottom - buttons[0].box.top - buttons[0].box.bottom) / 2) <= 1, bar);
  check(`36px toolbar is draggable but its buttons and tabs are not (${phase})`, bars.every(b =>
    near(b.box?.top, 0) && near(b.box?.height, 36) && b.region === "drag" && b.controls?.length && b.controls.every(r => r === "no-drag")) &&
    buttons.length === 3 && buttons.every(b => b.region === "no-drag"), bars);

  const width = Math.min(440, state.width);
  const rect = { x: state.width - width, y: 0, width, height: 44 };
  win.webContents.invalidate();
  let png, pixels;
  const continuous = await waitFor(async () => {
    const image = await capture(win, rect);
    if (!image) return false;
    png = image.toPNG();
    pixels = captionDivider(png, rect, bar);
    return pixels.ok;
  }, 3000);
  if (png && (panelOpen || !continuous)) fs.writeFileSync(path.join(dir, panelOpen ? "caption-buttons.png" : "caption-closed.png"), png);
  check(`painted toolbar divider reaches the last pixel (${phase})`, continuous, { rect, border: bar.border, dpr: state.dpr, pixels });
}

async function checkCaptionActions(win, run, shell, check) {
  const state = () => run(`(${captionState})(true)`);
  for (const b of (await state()).groups[0]?.buttons ?? []) {
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(b.box.left + b.box.width / 2), y: Math.round(b.box.top + b.box.height / 2) });
    const hover = await waitFor(() => run(`(() => {
      const button = document.querySelector('[data-window-action="${b.action}"]:hover');
      if (!button) return null;
      const css = getComputedStyle(button);
      return { bg: css.backgroundColor, fg: css.color, radius: css.borderRadius, dark: getComputedStyle(document.documentElement).colorScheme === "dark" };
    })()`), 2000);
    check(`full square hover on ${b.action}`, hover?.radius === "0px" && (b.action === "close" ? hover.bg === "rgb(196, 43, 28)" && hover.fg === "rgb(255, 255, 255)" : hover.dark ? hover.bg !== "rgba(0, 0, 0, 0)" : hover.bg === "rgb(232, 233, 234)"), hover);
  }
  const press = async (action) => {
    const box = (await state()).groups[0]?.buttons.find(b => b.action === action)?.box;
    if (!box) return false;
    click(win.webContents, { x: Math.floor((box.left + box.right) / 2), y: Math.floor((box.top + box.bottom) / 2) }, "left");
    return true;
  };
  // Native maximize/restore can show a hidden window. Intercept the OS calls
  // on this test window only, after the real renderer/preload/main IPC path.
  let maximized = false;
  const stubs = [];
  try {
    stubs.push(mock.method(win, "isMaximized", () => maximized));
    for (const name of ["minimize", "maximize", "unmaximize"]) {
      stubs.push(mock.method(win, name, () => {
        if (name !== "minimize") {
          maximized = name === "maximize";
          win.emit(name);
        }
      }));
    }
    for (const [i, name] of ["minimize", "maximize", "unmaximize"].entries()) {
      const reached = await press(name === "minimize" ? name : "toggle-maximize") &&
        await waitFor(() => stubs[i + 1].mock.callCount() === 1, 2000);
      check(`caption click reaches ${name} via IPC`, reached);
      if (name !== "minimize") check(`maximize button reflects ${name}`, reached && await waitFor(async () =>
        (await state()).groups[0]?.buttons[1]?.maximized === String(name === "maximize"), 2000));
    }
  } finally { for (const stub of stubs) stub.mock.restore(); }

  // Already invisible: checking isVisible alone would pass even if the IPC did nothing.
  const hide = mock.method(win, "hide"); // Calls through to the real close-to-tray operation.
  let closed = false;
  const onClose = () => { closed = true; };
  win.on("close", onClose);
  try {
    const requested = await press("close") && await waitFor(() => closed && hide.mock.callCount() > 0, 2000);
    check("caption close reaches the real close-to-tray handler", requested && !win.isDestroyed() && !win.isVisible() && shell.mainWindow() === win);
  } finally {
    win.removeListener("close", onClose);
    hide.mock.restore();
  }
}

/**
 * The two things pi-web's page asks the shell for a file (lib/desktop-host.ts):
 * the menu of a file link in the chat, and the file panel's "Show in Explorer"
 * button. Both end in the shell's record instead of on screen.
 */
async function probeFileActions(shell, win, filePath, check) {
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
  await checkCaption(win, shell.dir, run, false, check);
  check("a single-turn chat has no visible navigator", await run(`!document.querySelector('[data-turn-navigator]')?.checkVisibility()`));

  // The user's own message is no file link: the page's usual menu, as before.
  const plain = await run(`(() => { const el = [...document.querySelectorAll("[data-entry-id] p, [data-entry-id] div, [data-entry-id] span")].reverse().find((node) => node.textContent === "Write the report."); return el ? ${center}(el) : null; })()`);
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
  // The compositor may suspend panel transitions in a hidden BrowserWindow.
  // Measure the final layout rather than the first one-pixel frame.
  await run(`document.querySelector("#file-panel").getAnimations().forEach(a => a.finish())`);
  await checkCaption(win, shell.dir, run, true, check);
  await saveScreenshot(win, shell.dir, "file-panel.png");

  requests.length = 0;
  await run(`document.querySelector("#file-panel a[download]").previousElementSibling.click()`);
  const reveal = await waitFor(() => requests.find((entry) => entry.action === "reveal"), 5000);
  check("the button shows the file in Explorer", samePath(reveal?.select), { asked: reveal, file: filePath });
  await checkCaptionActions(win, run, shell, check);
}

// Runs in the renderer. A prompt behind the header or composer is not a successful jump.
function turnNavigationState(ids) {
  const rows = ids.map((id) => document.querySelector(`[data-entry-id="${id}"]`));
  const mounted = rows.find(Boolean);
  if (!mounted) return null;
  let port = mounted.parentElement;
  while (port && !["auto", "scroll"].includes(getComputedStyle(port).overflowY)) port = port.parentElement;
  if (!port) return null;
  const view = port.getBoundingClientRect();
  const box = (el) => el?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().toJSON();
  const nav = document.querySelector("[data-turn-navigator]");
  const columnLeft = mounted.getBoundingClientRect().left;
  return {
    rail: box(nav), role: nav?.getAttribute("role"), turn: Number(nav?.getAttribute("aria-valuenow")),
    columnLeft, gutter: columnLeft - view.left, first: Number(nav?.getAttribute("aria-valuemin")),
    ticks: nav ? [...nav.children].map(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 3), y: Math.round(r.top + r.height / 2) }; }) : [],
    visible: rows.map((row) => { const r = row?.getBoundingClientRect(); return !!r && r.top >= view.top - 1 && r.bottom <= view.bottom + 1; }),
    cards: [...document.querySelectorAll("[data-turn-preview]")].map((el) => ({ box: box(el), text: el.textContent })).filter((card) => card.box),
  };
}

function writeTurnSession(shell, workDir) {
  const prompts = Array.from({ length: 32 }, (_, i) => `Review section ${i + 1}.`);
  // One screen cannot show adjacent prompts together.
  const longReply = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n");
  const ids = writeFixtureSession(shell, workDir, NAV_SESSION_ID, prompts.map((prompt, i) => [prompt, i >= 25 && i < 31 ? longReply : "Done."]));
  return { ids, prompts };
}

async function probeTurnNavigator(shell, win, { ids, prompts }, check) {
  const wc = win.webContents;
  const run = (source) => wc.executeJavaScript(source, true);
  const state = () => run(`(${turnNavigationState})(${JSON.stringify(ids)})`);
  const matches = (test, ms = 5000) => waitFor(async () => { const s = await state(); return s && test(s) && s; }, ms);
  const at = (n) => matches((s) => s.turn === n && s.visible[n - 1]);
  const key = (name) => run(`(() => {
    const rail = document.querySelector('[data-turn-navigator]');
    rail?.focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true }));
  })()`);
  await wc.loadURL(`${shell.backend.origin}/?session=${NAV_SESSION_ID}`);
  const wide = await matches((s) => s.rail && s.gutter >= 64, PAGE_TIMEOUT_MS);
  check("a wide chat shows a turn slider in the left gutter", wide?.role === "slider" && wide.rail.right <= wide.columnLeft, wide ?? await state());
  if (!wide) return;
  check("the idle navigator has no preview", wide.cards.length === 0, wide.cards);
  await key("End");
  check("End jumps to the last prompt", await at(32));

  // Hovering the first turn changes the preview, not the transcript's position.
  const point = (s, n) => s.ticks[n - s.first];
  const move = (s, n) => wc.sendInputEvent({ type: "mouseMove", ...point(s, n) });
  const hasLabel = (s) => s.cards.length === 1 && s.cards[0].text.includes(prompts[26]) && s.cards[0].text.includes("27/32");
  move(wide, 27);
  const hovered = await matches(s => s.cards.length === 1 && s.cards[0].text.includes(prompts[26]) && !s.visible[26] && s.visible[31]);
  check("hover previews just the target turn without scrolling", hovered, hovered ? undefined : await state());
  check("the partial page labels its 27th turn 27/32", wide.first > 1 && wide.ticks.length < 32 && hovered && hasLabel(hovered));

  // A hidden window coalesces scroll events. Observe the request on the real
  // scrollport and forward it unchanged; at() independently checks its result.
  await run(`(() => {
    let port = document.querySelector("[data-entry-id]");
    while (port && !["auto", "scroll"].includes(getComputedStyle(port).overflowY)) port = port.parentElement;
    window.navProbe = { port, modes: [] };
    const scrollTo = port.scrollTo.bind(port);
    port.scrollTo = (...args) => { window.navProbe.modes.push(args[0]?.behavior); return scrollTo(...args); };
  })()`);
  const clearTrace = () => run("window.navProbe.modes.length = 0");
  const checkMotion = async (name) => {
    const trace = await run(`({ modes: window.navProbe.modes, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })`);
    check(name, trace.modes.length > 0 && trace.modes.every(mode => mode === (trace.reduced ? "instant" : "smooth")), trace);
  };
  if (hovered) {
    const card = hovered.cards[0].box;
    await clearTrace();
    click(wc, { x: Math.round(card.x + card.width / 2), y: Math.round(card.y + card.height / 2) }, "left");
    check("clicking the preview jumps to its prompt", await at(27));
    await checkMotion("preview click animates unless reduced motion is requested");
  }
  wc.sendInputEvent({ type: "mouseMove", x: 1, y: 1 });
  check("moving off the navigator dismisses its preview", await matches((s) => !s.cards.length));
  await key("ArrowDown");
  check("ArrowDown jumps to the next prompt", await at(28));
  await key("ArrowUp");
  check("ArrowUp jumps to the previous prompt", await at(27));

  await clearTrace();
  const from = point(wide, 30), to = point(wide, 28);
  wc.sendInputEvent({ type: "mouseMove", ...from });
  wc.sendInputEvent({ type: "mouseDown", ...from, button: "left", clickCount: 1 });
  try {
    check("pressing a tick reaches its prompt", await at(30));
    await checkMotion("tick press animates unless reduced motion is requested");
    const focus = await run(`(() => {
      const rail = document.querySelector("[data-turn-navigator]");
      const css = getComputedStyle(rail);
      return { focused: rail === document.activeElement, outline: css.outlineStyle, shadow: css.boxShadow };
    })()`);
    check("the clicked slider has focus without a full rail ring", focus.focused && focus.outline === "none" && focus.shadow === "none", focus);
    // Measure after React handles this very pointermove, before a smooth scroll could finish.
    await run(`document.addEventListener("pointermove", e => {
      const rail = document.querySelector("[data-turn-navigator]");
      const target = document.querySelector(${JSON.stringify(`[data-entry-id="${ids[27]}"]`)});
      window.navProbe.drag = { captured: rail.hasPointerCapture(e.pointerId), offset: target.getBoundingClientRect().top - window.navProbe.port.getBoundingClientRect().top };
    }, { once: true })`);
    wc.sendInputEvent({ type: "mouseMove", ...to, modifiers: ["leftButtonDown"] });
    const drag = await waitFor(() => run("window.navProbe.drag"), 5000);
    check("drag reaches the new prompt in the pointer event itself", drag?.captured && Math.abs(drag.offset - 16) < 3, drag);
  } finally {
    wc.sendInputEvent({ type: "mouseUp", ...to, button: "left", clickCount: 1 });
  }

  // An offscreen window has no OS keyboard focus. Ask Chromium to resolve the
  // real :focus-visible rules without depending on the foreground application.
  wc.debugger.attach();
  try {
    const send = (method, params) => wc.debugger.sendCommand(method, params);
    await send("DOM.enable");
    await send("CSS.enable");
    const { root } = await send("DOM.getDocument");
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-turn-navigator]" });
    await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus-visible"] });
    const focus = await run(`(() => {
      const rail = document.querySelector("[data-turn-navigator]");
      const i = Number(rail.ariaValueNow) - Number(rail.ariaValueMin);
      const tick = getComputedStyle(rail.children[i]);
      const other = getComputedStyle(rail.children[i ? 0 : 1]);
      return { outline: getComputedStyle(rail).outlineStyle, shadow: getComputedStyle(rail).boxShadow,
        thicker: parseFloat(tick.height) > parseFloat(other.height), accent: tick.backgroundColor !== other.backgroundColor };
    })()`);
    check("keyboard focus highlights the selected tick, not the entire rail", focus.outline === "none" && focus.shadow === "none" && focus.thicker && focus.accent, focus);
  } finally { wc.debugger.detach(); }

  await run("window.navProbe.port.scrollTop = 0");
  const full = await matches(s => s.first === 1 && s.ticks.length === 32);
  if (full) move(full, 27);
  check("loading older history preserves the same prompt and 27/32 label", full && await matches(hasLabel));
  win.setContentSize(840, 760);
  check("a narrow chat hides the navigator and its preview", await matches((s) => s.gutter < 64 && !s.rail && !s.cards.length));
}

/** The `server-fails` scenario: the server cannot start, and the window must say so and offer a way on. */
/** The models editor's import defaults are kept beside pi's models.json, never in it. */
async function probeImportDefaults(shell, win, check) {
  const agentDir = path.join(shell.dir, "agent");
  const defaults = await win.webContents.executeJavaScript(`(async () => {
    const url = "/api/models-config/import-defaults";
    const put = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contextWindows: { "self-test": 64000 } }) });
    return { put: put.status, get: await fetch(url).then((response) => response.json()) };
  })()`, true);
  const modelsJson = path.join(agentDir, "models.json");
  const storedPath = path.join(agentDir, "pi-web-model-import.json");
  const stored = fs.existsSync(storedPath) ? JSON.parse(fs.readFileSync(storedPath, "utf8")) : null;
  check("a provider's import default is stored in the app's own file, not in models.json", defaults.put === 200 && defaults.get.contextWindows?.["self-test"] === 64000 &&
    stored?.contextWindows["self-test"] === 64000 && !(fs.existsSync(modelsJson) && fs.readFileSync(modelsJson, "utf8").includes("piWebImport")), { defaults, stored });
}

// The probes of pi-web's pages that follow start on the file-link session's page.
const SESSION_ROW = `[data-row-key="session:group:${SESSION_ID}"] .session-tree-main`;
const OPEN_SETTINGS = `[...document.querySelectorAll("button")].find((button) => ["Settings", "设置", "設定"].includes(button.getAttribute("aria-label"))).click()`;

/** Loads the file-link session's page and waits for the sidebar to list it. Answers the page's `run`, or null. */
async function openFixtureSession(shell, win, check) {
  const run = (source) => win.webContents.executeJavaScript(source, true);
  await win.webContents.loadURL(`${shell.backend.origin}/?session=${SESSION_ID}`);
  if (await waitFor(() => run(`Boolean(document.querySelector(${JSON.stringify(SESSION_ROW)}))`), PAGE_TIMEOUT_MS)) return run;
  check("the sidebar lists the session", false, await describeWindow(shell));
  return null;
}

async function closeSettings(win, run) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  return waitFor(() => run(`!document.querySelector(".settings-general")`), 5000);
}

/** The tasks page lists the sessions without opening one, and a row of it opens its session. */
async function probeTasksPage(shell, win, check) {
  const run = await openFixtureSession(shell, win, check);
  if (!run) return;
  await run(`document.querySelector(".sidebar-tasks-entry").click()`);
  const tasks = await waitFor(() => run(`(() => {
    const rows = [...document.querySelectorAll("[data-group] li button")];
    if (!rows.length) return null;
    const composer = document.querySelector("textarea.chat-input-textarea");
    return {
      current: document.querySelector(".sidebar-tasks-entry").getAttribute("aria-current"),
      groups: [...document.querySelectorAll("[data-group]")].map((el) => el.dataset.group),
      titles: rows.map((row) => row.textContent),
      composerShown: Boolean(composer?.checkVisibility()),
    };
  })()`), PAGE_TIMEOUT_MS);
  check("Tasks opens a page of sessions in place of the chat", tasks?.current === "page" && tasks.composerShown === false, tasks ?? await describeWindow(shell));
  if (!tasks) return;
  check("a session nothing is running in is listed under Recent", tasks.groups.join() === "recent" && tasks.titles.some((title) => title.includes("Write the report.")), tasks);
  await run(`[...document.querySelectorAll("[data-group] li button")].find((row) => row.textContent.includes("Write the report.")).click()`);
  const backInChat = await waitFor(() => run(`new URLSearchParams(location.search).get("session") === ${JSON.stringify(SESSION_ID)} && !document.querySelector("[data-group]") && Boolean(document.querySelector("textarea.chat-input-textarea")?.checkVisibility())`), PAGE_TIMEOUT_MS);
  check("a row of the tasks page opens its session", backInChat);
}

/**
 * The sidebar's General and Projects sections, and a General chat: a fresh
 * composer in the folder the page reserved for it. No session is started and
 * nothing is sent to a model.
 */
async function probeGeneralChats(shell, win, check) {
  const run = await openFixtureSession(shell, win, check);
  if (!run) return;
  const agentDir = path.join(shell.dir, "agent");
  // A self-test's agent directory holds its General chats too (lib/temp-chats.ts).
  const chatsRoot = path.join(agentDir, "pi-web-chats");
  const registryPath = path.join(agentDir, "pi-web-temp-chats.json");
  const chatFolders = () => (fs.existsSync(chatsRoot) ? fs.readdirSync(chatsRoot).filter((name) => name.startsWith("chat-")) : []);

  const sections = await run(`(() => {
    const entries = [".sidebar-tasks-entry", '[data-row-key="chats-header"]', '[data-row-key="projects-header"]'].map((selector) => document.querySelector(selector));
    if (entries.some((el) => !el)) return null;
    // Top to bottom, from the Tasks entry: each row of the tree, and the gap above it.
    const rows = [entries[0], ...document.querySelectorAll(".session-tree-row")].map((el) => ({ key: el.dataset.rowKey ?? "", box: el.getBoundingClientRect() })).sort((a, b) => a.box.top - b.box.top);
    return {
      tops: entries.map((el) => Math.round(el.getBoundingClientRect().top)),
      heights: entries.map((el) => Math.round(el.getBoundingClientRect().height)),
      gaps: rows.slice(1).map((row, index) => ({ key: row.key, gap: Math.round(row.box.top - rows[index].box.bottom) })),
      gapAboveTasks: parseFloat(getComputedStyle(entries[0]).marginTop),
      lefts: entries.map((el) => Math.round(el.querySelector("span").getBoundingClientRect().left)),
      add: Boolean(entries[1].querySelector(".sidebar-section-add")),
      footer: Boolean(document.querySelector('[data-row-key="footer-open"]')),
    };
  })()`);
  check("the sidebar lists Tasks, General and Projects, in that order", sections && sections.tops[0] < sections.tops[1] && sections.tops[1] < sections.tops[2], sections ?? await describeWindow(shell));
  if (!sections) return;
  check("the three entries' labels start on one line", new Set(sections.lefts).size === 1, sections.lefts);
  // The gap above the Tasks entry parts the three entries; what Projects lists sits a step closer, below it and to one another.
  const entryGaps = sections.gaps.filter(({ key }) => key === "chats-header" || key === "projects-header").map(({ gap }) => gap);
  const projectGaps = new Set(sections.gaps.filter(({ key, gap }) => gap !== 0 && /^(group|pinned-header)/.test(key)).map(({ gap }) => gap));
  check("the entries are rows of one height and one gap apart, and the projects sit closer",
    new Set(sections.heights).size === 1 && entryGaps.length === 2 && entryGaps.every((gap) => gap === sections.gapAboveTasks)
      && projectGaps.size === 1 && [...projectGaps][0] < sections.gapAboveTasks,
    { heights: sections.heights, gaps: sections.gaps, gapAboveTasks: sections.gapAboveTasks });
  check("General has a +, and pi-web's Open another project row is gone", sections.add && !sections.footer, sections);

  // A General chat: a fresh composer in a folder of its own, which the page reserved ahead.
  await run(`document.querySelector('[data-row-key="chats-header"] .sidebar-section-add').click()`);
  const draft = await waitFor(() => run(`Boolean(document.querySelector('[data-row-key="chat-draft"]') && document.querySelector(".new-session-hero")?.checkVisibility())`), PAGE_TIMEOUT_MS);
  check("General + opens a fresh composer with a row of its own", draft, draft ? undefined : await describeWindow(shell));
  if (!draft) return;
  const folders = chatFolders();
  // The folder the main window holds: asked again under its name, the server answers the same one.
  const { cwd = "" } = await run(`fetch("/api/temp-chats?holder=desktop-main-window", { method: "POST" }).then((response) => response.json())`);
  check("the main window holds one folder for its chat, the same after its page was given back and the server restarted", folders.length === 1 && folders[0] === path.basename(cwd) && fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory(), { folders, cwd });
  // The composer asks pi-web's own routes for that folder; a refusal is the "Access denied" in place of the model.
  const access = await run(`(async () => {
    const status = (cwd) => fetch("/api/models?cwd=" + encodeURIComponent(cwd)).then((response) => response.status);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { folder: await status(${JSON.stringify(cwd)}), root: await status(${JSON.stringify(path.dirname(cwd))}), denied: document.body.innerText.includes("Access denied") };
  })()`);
  check("pi-web's model list serves the reserved folder, and not the folder above it", access.folder === 200 && access.root === 403, access);
  check("the composer shows no access error", access.denied === false, access);
  // Left and opened again, it is the same chat in the same folder.
  await run(`document.querySelector(${JSON.stringify(SESSION_ROW)}).click()`);
  await waitFor(() => run(`!document.querySelector('[data-row-key="chat-draft"]')`), PAGE_TIMEOUT_MS);
  await run(`document.querySelector('[data-row-key="chats-header"] .sidebar-section-add').click()`);
  const reopened = await waitFor(() => run(`Boolean(document.querySelector('[data-row-key="chat-draft"]'))`), PAGE_TIMEOUT_MS);
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  check("a chat left unsent keeps its folder: opening it again reserves no other", reopened && chatFolders().join() === folders.join() && registry.cwds.length === folders.length, { folders: chatFolders(), registry });

  await run(OPEN_SETTINGS);
  const named = await waitFor(() => run(`(() => {
    const text = document.querySelector("#settings-temp-chat-folder")?.parentElement.querySelector(".settings-chat-option span")?.textContent;
    // A path, not the row's "Loading…": the folder has been read.
    return text && /[\\\\/]/.test(text) ? text : null;
  })()`), PAGE_TIMEOUT_MS);
  check("General settings name the folder of the General chats", typeof named === "string" && path.basename(named) === path.basename(chatsRoot), named);
  await closeSettings(win, run);
}

/** Projects +: pi-web's directory picker and registration of an existing folder without a session. */
async function probeNewProject(shell, win, workDir, check) {
  const run = await openFixtureSession(shell, win, check);
  if (!run) return;
  const add = '[data-row-key="projects-header"] .sidebar-section-add';
  const dialog = ".directory-picker-backdrop";
  await run(`document.querySelector(${JSON.stringify(add)}).click()`);
  const opened = await waitFor(() => run(`Boolean(document.querySelector(".directory-picker-path"))`), 5000);
  check("Projects + opens pi-web's directory picker", opened, opened ? undefined : await describeWindow(shell));
  if (!opened) return;
  await run(`document.querySelector(".directory-picker-footer button:nth-last-child(2)").click()`);
  const closed = await waitFor(() => run(`!document.querySelector(${JSON.stringify(dialog)})`), 5000);
  check("Cancel closes the directory picker", closed);
  if (!closed) return;

  const folder = path.join(workDir, "opened with projects plus");
  fs.mkdirSync(folder, { recursive: true });
  const selectedFolder = fs.realpathSync(folder);
  await run(`document.querySelector(${JSON.stringify(add)}).click()`);
  const select = ".directory-picker-footer button:last-child";
  const hasPathInput = await waitFor(() => run(`Boolean(document.querySelector(".directory-picker-path"))`), 5000);
  check("the directory picker is ready to enter a path", hasPathInput);
  if (!hasPathInput) return;
  const entered = await waitFor(() => run(`(() => {
    const input = document.querySelector(".directory-picker-path");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(selectedFolder)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return document.querySelector(${JSON.stringify(select)})?.matches(":enabled");
  })()`), 10000);
  check("the typed folder can be selected", entered);
  if (!entered) return;
  await run(`document.querySelector(${JSON.stringify(select)}).click()`);
  const listed = await waitFor(() => run(`(async () => {
    if (document.querySelector(${JSON.stringify(dialog)})) return false;
    const { state } = await (await fetch("/api/sessions/ui-state")).json();
    const entry = Object.entries(state?.createdProjects ?? {}).find(([, root]) => root === ${JSON.stringify(selectedFolder)});
    return Boolean(entry && [...document.querySelectorAll("[data-row-key]")].some(row => row.dataset.rowKey === "group:" + entry[0]));
  })()`), 20_000);
  check("the selected folder stays listed as a project before it has a session", listed, listed ? undefined : await describeWindow(shell));
}

/** Settings › General: two columns in a wide window, with the tool switches loaded in their place. */
async function probeGeneralSettings(shell, win, check) {
  const run = await openFixtureSession(shell, win, check);
  if (!run) return;
  await run(OPEN_SETTINGS);
  const settings = await waitFor(() => run(`(() => {
    const columns = [...document.querySelectorAll(".settings-general-layout > .settings-general-column")].map((el) => el.getBoundingClientRect());
    const tools = document.querySelectorAll(".settings-builtin-tools input[type=checkbox]").length;
    if (columns.length !== 2 || !tools) return null;
    return { sideBySide: Math.round(columns[0].top) === Math.round(columns[1].top) && columns[1].left >= columns[0].right, gap: Math.round(columns[1].left - columns[0].right), tools };
  })()`), PAGE_TIMEOUT_MS);
  check("General settings show in two columns with the tool switches loaded", settings?.sideBySide && settings.gap === 32, settings ?? await describeWindow(shell));
  check("Escape closes Settings", await closeSettings(win, run));
}

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
        buttons: [...document.querySelectorAll(".actions button")].map(b => b.offsetParent !== null && b.textContent && b.dataset.action),
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
  check("the failure page offers retry, logs and quit", page?.buttons.join() === "retry,logs,quit", page?.buttons);
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
  // Deep links restore from the session catalogue; both fixtures must be in its first snapshot.
  const linkPath = writeLinkedFileSession(shell, workDir);
  const turnFixture = writeTurnSession(shell, workDir);

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

  if (reloaded) {
    const original = reloaded.getContentSize();
    try {
      reloaded.setContentSize(1760, 760);
      await probeTurnNavigator(shell, reloaded, turnFixture, check);
      reloaded.setContentSize(1760, 760);
      await probeImportDefaults(shell, reloaded, check);
      await probeTasksPage(shell, reloaded, check);
      await probeGeneralChats(shell, reloaded, check);
      await probeNewProject(shell, reloaded, workDir, check);
      await probeGeneralSettings(shell, reloaded, check);
      await probeFileActions(shell, reloaded, linkPath, check);
    } finally {
      reloaded.setContentSize(...original);
    }
  }
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
