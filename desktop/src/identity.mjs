/**
 * Identity that stays put when the product is renamed. Kept free of Electron
 * imports so the build scripts can read it too.
 */

/** The taskbar and notification identity; the installer's shortcuts carry the same one. */
export const APP_ID = "io.github.kabuda2077.pi-web-desktop";

/** Folder under %APPDATA% holding the window state and the page's own storage (theme, drafts, sidebar). */
export const PROFILE_NAME = "pi-web-desktop";
