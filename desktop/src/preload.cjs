"use strict";

// Runs in every window before the page's own scripts, in a world of its own:
// the page reaches only what is exposed below, never `require` or the IPC.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("piDesktopHost", {
  /** A button on the shell's own loading page. The main process ignores it from any other page. */
  action: (name) => ipcRenderer.send("pi-desktop:action", String(name)),
  /** The page asks for its window to come forward. */
  focusWindow: () => ipcRenderer.send("pi-desktop:focus-window"),
  /** Shows a file in Explorer, selected in its folder. Answers whether there was something to show. */
  revealFile: (filePath) => ipcRenderer.invoke("pi-desktop:reveal-file", String(filePath)),
  /** The menu of a file link in the chat. Answers "open" when the page is to open the file in its panel. */
  showFileMenu: (request) =>
    ipcRenderer.invoke("pi-desktop:file-menu", {
      filePath: String(request?.filePath ?? ""),
      hasSelection: request?.hasSelection === true,
    }),
});

if (location.protocol !== "file:") {
  contextBridge.executeInMainWorld({
    func: () => {
      // Electron shows the notifications a page creates and silently drops the
      // ones a service worker shows, which pi-web prefers whenever it has a
      // worker (lib/browser-notifications.ts): "Task finished" would never
      // appear. So the page sees a browser without service workers, which
      // pi-web supports everywhere it uses one. Nothing else is lost: the
      // worker's offline page and asset cache serve browsers and phones, and
      // this app has its own page for a server that is down.
      delete Navigator.prototype.serviceWorker;

      // pi-web calls window.focus() when its notification is clicked. A browser
      // brings the tab forward for that; Electron leaves it to the app.
      const focus = window.focus;
      window.focus = function focusWindow(...args) {
        window.piDesktopHost.focusWindow();
        return focus.apply(this, args);
      };
    },
  });
}
