"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The General chat a page starts next: its draft's id, and the folder reserved for it. */
export interface HeldTempChat { id: string; cwd: string }

const HOLDER_STORAGE_KEY = "pi-web:temp-chat-holder";

/**
 * This page's name at /api/temp-chats, which answers the same folder to the
 * same name. The desktop app's main window has one name whatever page it
 * shows: the shell ends a hidden page without the page hearing of it, and the
 * page that follows must get its folder. A tab keeps its name over a reload.
 */
function holderName(): string {
  if (window.piDesktopHost?.windowControls) return "desktop-main-window";
  try {
    const stored = sessionStorage.getItem(HOLDER_STORAGE_KEY);
    if (stored) return stored;
    const name = crypto.randomUUID();
    sessionStorage.setItem(HOLDER_STORAGE_KEY, name);
    return name;
  } catch {
    // No storage: a name for this page alone.
    return crypto.randomUUID();
  }
}

let holder: string | undefined;
/** Where this page reserves its folder and gives it back. Its name is found once a page. */
const reservationUrl = () => `/api/temp-chats?holder=${encodeURIComponent(holder ??= holderName())}`;

/**
 * The folders of the General chats (/api/temp-chats): which cwds are chats,
 * and the folder this page holds for the chat it starts next. That folder is
 * reserved ahead, when the page loads and again once a chat has taken it, so
 * that a General chat's composer opens at once: a composer that waited for the
 * reservation would leave the chat before it on screen, taking what is typed.
 */
export function useTempChatDirectories(sessions: readonly { cwd: string }[]) {
  const [cwds, setCwds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  // Another window can start a chat while this one is open. Reconcile with the
  // persistent directory registry when the session catalog changes.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/temp-chats", { signal: controller.signal, cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json();
      if (!controller.signal.aborted && Array.isArray(data.cwds)) {
        setReady(true);
        setCwds((previous) => {
          const next = [...new Set([...previous, ...data.cwds.filter((d: unknown) => typeof d === "string")])] as string[];
          return next.length === previous.length ? previous : next;
        });
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [sessions]);

  const held = useRef<HeldTempChat | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  /** Resolves once a folder is held, reserving one unless one is; rejects when none could be had. */
  const prepare = useCallback((): Promise<void> => {
    if (held.current) return Promise.resolve();
    return pending.current ??= (async () => {
      try {
        const r = await fetch(reservationUrl(), { method: "POST" });
        const data = await r.json();
        if (!r.ok || typeof data.cwd !== "string" || !data.cwd) throw new Error(data.error || `HTTP ${r.status}`);
        const cwd: string = data.cwd;
        held.current = { id: crypto.randomUUID(), cwd };
        setCwds((prev) => prev.includes(cwd) ? prev : [...prev, cwd]);
      } finally {
        pending.current = null;
      }
    })();
  }, []);
  // A failure here is silent: opening a chat asks again, and reports it.
  useEffect(() => { prepare().catch(() => {}); }, [prepare]);

  /** The draft became a chat: its folder is the chat's now, and the next one is reserved. */
  const started = useCallback((draftId: string) => {
    if (held.current?.id !== draftId) return;
    held.current = null;
    prepare().catch(() => {});
  }, [prepare]);

  // A tab that goes away hands back the folder no chat took, so it is the next
  // tab's. Where this is not heard, the folder is its holder's until the
  // server restarts.
  useEffect(() => {
    const release = () => {
      if (held.current) void fetch(reservationUrl(), { method: "DELETE", keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, []);

  return { cwds, ready, held, prepare, started };
}
