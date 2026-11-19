/**
 * What the Pi Web Desktop shell offers the page (desktop/src/preload.cjs).
 * A browser has none of it, and the page then shows nothing that needs it.
 */
export interface DesktopHost {
  /** Shows a file in Explorer, selected in its folder. Answers whether there was something to show. */
  revealFile(filePath: string): Promise<boolean>;
  /** The native menu of a file link. Answers "open" when the page is to open the file in its panel. */
  showFileMenu(request: { filePath: string; hasSelection: boolean }): Promise<"open" | null>;
}

declare global {
  interface Window {
    piDesktopHost?: Partial<DesktopHost>;
  }
}

export function desktopHost(): DesktopHost | null {
  if (typeof window === "undefined") return null;
  const host = window.piDesktopHost;
  return host?.revealFile && host.showFileMenu ? (host as DesktopHost) : null;
}
