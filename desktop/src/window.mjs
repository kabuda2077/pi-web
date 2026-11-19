import { BrowserWindow, Menu, clipboard, shell } from "electron";
import path from "node:path";
import { externalUrl, isAppUrl } from "./links.mjs";
import { MIN_SIZE, boundsToRemember } from "./window-state.mjs";

const STATE_SAVE_DELAY_MS = 400;
const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 4;

const WEB_PREFERENCES = {
  preload: path.join(import.meta.dirname, "preload.cjs"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // Chromium's own PDF viewer, which the file panel shows PDFs in.
  plugins: true,
  // The composer holds code, paths and mixed languages; squiggles there are noise,
  // and the spell checker would download dictionaries.
  spellcheck: false,
};

/**
 * @typedef {object} WindowContext
 * @property {() => (string | null)} origin The local server's origin
 * @property {Record<string, string>} strings
 * @property {(line: string) => void} log
 * @property {boolean} devTools Whether the context menu offers Inspect
 * @property {string | undefined} icon Window icon; unset in a packaged app, which uses the executable's
 * @property {() => string} backgroundColor
 * @property {object[] | null} record A self-test's list: a menu that would open is added to it and nothing opens
 */

function windowOptions(context) {
  return {
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: context.backgroundColor(),
    icon: context.icon,
    // A self-test's window is never shown, and a hidden page stops its
    // animations: the file panel would stay at the width it opens from.
    webPreferences: { ...WEB_PREFERENCES, ...(context.record ? { backgroundThrottling: false } : {}) },
  };
}

/** Hands a link that leaves the app to the OS, when it is one the OS may open. */
function openExternal(url, context) {
  const target = externalUrl(url);
  if (!target) {
    context.log(`blocked a link the app does not open: ${url.slice(0, 200)}`);
    return;
  }
  shell.openExternal(target).catch((error) => context.log(`could not open ${target}: ${error.message}`));
}

function contextMenuTemplate(params, webContents, context) {
  const t = context.strings;
  const groups = [];

  if (params.linkURL) {
    const link = params.linkURL;
    groups.push([
      ...(isAppUrl(link, context.origin()) || !externalUrl(link)
        ? []
        : [{ label: t.menuOpenLink, click: () => openExternal(link, context) }]),
      { label: t.menuCopyLink, click: () => clipboard.writeText(link) },
    ]);
  }

  if (params.mediaType === "image" && params.hasImageContents) {
    groups.push([
      { label: t.menuCopyImage, click: () => webContents.copyImageAt(params.x, params.y) },
      { label: t.menuSaveImage, click: () => webContents.downloadURL(params.srcURL) },
    ]);
  }

  if (params.isEditable) {
    groups.push([
      { role: "cut", label: t.menuCut, enabled: params.editFlags.canCut },
      { role: "copy", label: t.menuCopy, enabled: params.editFlags.canCopy },
      { role: "paste", label: t.menuPaste, enabled: params.editFlags.canPaste },
      { role: "selectAll", label: t.menuSelectAll, enabled: params.editFlags.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) {
    groups.push([{ role: "copy", label: t.menuCopy }]);
  }

  if (context.devTools) {
    groups.push([{ label: t.menuInspect, click: () => webContents.inspectElement(params.x, params.y) }]);
  }

  return groups.flatMap((group, index) => (index === 0 ? group : [{ type: "separator" }, ...group]));
}

/**
 * What every window of the app obeys: it shows only the local server's pages,
 * links that leave go to the system browser, and right-click has the menu a
 * browser would give.
 */
function applyPolicy(win, context) {
  const webContents = win.webContents;
  // The menu stays set for its shortcuts (reload, zoom, dev tools); only its bar is hidden.
  win.setMenuBarVisibility(false);

  const keepInsideApp = (event) => {
    if (event.isMainFrame === false || isAppUrl(event.url, context.origin())) return;
    event.preventDefault();
    openExternal(event.url, context);
  };
  webContents.on("will-navigate", keepInsideApp);
  webContents.on("will-redirect", keepInsideApp);

  webContents.setWindowOpenHandler(({ url }) => {
    // "Open in new tab" and the session export are the app's own pages: a second window.
    if (isAppUrl(url, context.origin())) {
      return { action: "allow", overrideBrowserWindowOptions: windowOptions(context) };
    }
    openExternal(url, context);
    return { action: "deny" };
  });
  webContents.on("did-create-window", (child) => applyPolicy(child, context));

  webContents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params, webContents, context);
    if (context.record) context.record.push({ action: "page-menu", link: params.linkURL });
    else if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win });
  });

  // Ctrl + mouse wheel, as in a browser.
  webContents.on("zoom-changed", (_event, direction) => {
    const level = webContents.getZoomLevel() + (direction === "in" ? ZOOM_STEP : -ZOOM_STEP);
    webContents.setZoomLevel(Math.min(ZOOM_LIMIT, Math.max(-ZOOM_LIMIT, level)));
  });
}

/**
 * Opens an app window, hidden until the caller shows it.
 *
 * @param {{ x?: number, y?: number, width: number, height: number }} bounds
 * @param {WindowContext} context
 */
export function createAppWindow(bounds, context) {
  const win = new BrowserWindow({ ...bounds, show: false, ...windowOptions(context) });
  applyPolicy(win, context);
  return win;
}

/**
 * Calls save with the bounds to restore the window from next time, and whether
 * it is maximized, whenever they change.
 *
 * @param restored The bounds the window was created with
 */
export function trackWindowState(win, restored, save) {
  const created = win.getNormalBounds();
  let timer = null;
  const capture = () => {
    timer = null;
    if (win.isDestroyed() || win.isFullScreen()) return;
    save({ ...boundsToRemember(win.getNormalBounds(), created, restored), maximized: win.isMaximized() });
  };
  const later = () => {
    if (!timer) timer = setTimeout(capture, STATE_SAVE_DELAY_MS);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize"]) win.on(event, later);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    capture();
  });
}

/**
 * The page's own background colour and whether its theme is dark, so the next
 * window can open in the same colour instead of flashing white. Null when the
 * page has none to give.
 */
export async function readPageTheme(webContents) {
  try {
    const theme = await webContents.executeJavaScript(
      `(() => {
        const root = document.documentElement;
        return { bg: getComputedStyle(root).getPropertyValue("--bg").trim(), dark: root.classList.contains("dark") };
      })()`,
      true,
    );
    return /^#[0-9a-f]{6}$/i.test(theme?.bg ?? "") ? { bg: theme.bg, dark: theme.dark === true } : null;
  } catch {
    return null;
  }
}
