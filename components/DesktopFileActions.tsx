"use client";

import { useSyncExternalStore, type MouseEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { desktopHost } from "@/lib/desktop-host";
import type { Locale } from "@/lib/i18n/types";

// The desktop app's own controls for a file on this computer. Their text is
// kept here, not in lib/i18n/messages: those files change with every upstream
// release, and these few lines would have to be merged into them each time.
const REVEAL_LABEL: Record<Locale, string> = {
  en: "Show in Explorer",
  "zh-CN": "打开文件所在位置",
  "zh-TW": "開啟檔案所在位置",
};

const subscribeToNothing = () => () => {};
const noHost = () => null;

/** The file panel's button left of Download: shows the file in Explorer. Nothing in a browser. */
export function RevealFileButton({ filePath }: { filePath: string }) {
  const { locale } = useI18n();
  const host = useSyncExternalStore(subscribeToNothing, desktopHost, noHost);
  if (!host) return null;
  const label = REVEAL_LABEL[locale];
  return (
    <button
      type="button"
      onClick={() => { host.revealFile(filePath).catch((error) => console.error("Show in Explorer failed", error)); }}
      title={label}
      aria-label={label}
      className="file-viewer-icon-button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 8a2 2 0 0 1 2-2h3.4l1.9 1.9H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </svg>
    </button>
  );
}

/**
 * Right-click on a chat link to a local file: the desktop app's menu (Open,
 * Show in Explorer, Copy path) in place of the browser's, which a browser keeps.
 */
export function showFileLinkMenu(event: MouseEvent, filePath: string, open: () => void): void {
  const host = desktopHost();
  if (!host) return;
  event.preventDefault();
  const hasSelection = Boolean(window.getSelection()?.toString());
  host.showFileMenu({ filePath, hasSelection }).then(
    (choice) => { if (choice === "open") open(); },
    (error) => console.error("File menu failed", error),
  );
}
