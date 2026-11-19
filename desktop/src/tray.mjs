import { Menu, Tray, nativeImage } from "electron";

const TRAY_ICON_SIZE = 16;

/** The app icon at each size Windows asks a tray icon for, so it stays sharp on scaled displays. */
function trayImage(iconPath) {
  const source = nativeImage.createFromPath(iconPath);
  if (source.isEmpty()) return source;
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.25, 1.5, 2, 3]) {
    const size = Math.round(TRAY_ICON_SIZE * scaleFactor);
    image.addRepresentation({
      scaleFactor,
      width: size,
      height: size,
      buffer: source.resize({ width: size, height: size, quality: "best" }).toPNG(),
    });
  }
  return image;
}

/**
 * The tray icon that keeps the app reachable while its window is closed.
 *
 * @param options.actions show, restartServer, openLogs, quit
 */
export function createTray({ iconPath, tooltip, strings, actions }) {
  const tray = new Tray(trayImage(iconPath));
  tray.setToolTip(tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: strings.trayShow, click: actions.show },
      { type: "separator" },
      { label: strings.trayRestart, click: actions.restartServer },
      { label: strings.trayLogs, click: actions.openLogs },
      { type: "separator" },
      { label: strings.quit, click: actions.quit },
    ]),
  );
  tray.on("click", actions.show);
  return tray;
}
