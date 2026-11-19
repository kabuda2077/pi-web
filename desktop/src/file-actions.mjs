import { Menu, clipboard, shell } from "electron";
import { localFilePath, revealTarget } from "./files.mjs";

// What the page asks for a file on this computer (lib/desktop-host.ts in
// pi-web): showing it in Explorer, and the menu of a file link in the chat.

/**
 * @typedef {object} FileActionContext
 * @property {Record<string, string>} strings
 * @property {(line: string) => void} log
 * @property {object[] | null} record A self-test's list: what would be shown is added to it and nothing is shown
 */

/** Shows the target of revealTarget() in Explorer. */
function show(target, context) {
  if (context.record) {
    context.record.push({ action: "reveal", ...target });
  } else if (target.select) {
    shell.showItemInFolder(target.select);
  } else {
    shell.openPath(target.open).then((error) => {
      if (error) context.log(`could not open ${target.open}: ${error}`);
    });
  }
}

/**
 * Shows a file in Explorer, selected in its folder.
 *
 * @param {unknown} value The path the page gave
 * @param {FileActionContext} context
 * @returns {boolean} Whether there was something to show
 */
export function revealFile(value, context) {
  const filePath = localFilePath(value);
  const target = filePath && revealTarget(filePath);
  if (!target) {
    context.log(`nothing to show in Explorer for ${String(value).slice(0, 200)}`);
    return false;
  }
  show(target, context);
  return true;
}

/**
 * The menu of a file link: Open, Show in Explorer, Copy path.
 *
 * @param {Electron.BrowserWindow} win
 * @param {{ filePath?: unknown, hasSelection?: unknown }} request
 * @param {FileActionContext} context
 * @returns {Promise<"open" | null>} "open" when the page is to open the file in its own panel
 */
export function showFileMenu(win, request, context) {
  const t = context.strings;
  const filePath = localFilePath(request?.filePath);
  const target = filePath && revealTarget(filePath);

  return new Promise((resolve) => {
    const template = [
      { label: t.menuOpenFile, click: () => resolve("open") },
      { type: "separator" },
      { label: t.menuRevealFile, enabled: Boolean(target), click: () => show(target, context) },
      { label: t.menuCopyPath, enabled: Boolean(filePath), click: () => clipboard.writeText(filePath) },
      ...(request?.hasSelection === true ? [{ type: "separator" }, { role: "copy", label: t.menuCopy }] : []),
    ];
    if (context.record) {
      context.record.push({
        action: "menu",
        filePath,
        items: template.filter((item) => item.label).map((item) => ({ label: item.label, enabled: item.enabled !== false })),
      });
      // A self-test picks Open, so the page's side of the answer runs too.
      resolve("open");
      return;
    }
    Menu.buildFromTemplate(template).popup({
      window: win,
      // A chosen item's click comes before or just after the menu closes; a menu
      // closed without a choice answers null once that moment has passed.
      callback: () => setTimeout(() => resolve(null), 200),
    });
  });
}
