"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { WindowAction } from "@/lib/desktop-host";

// The preload capability is constant for the life of a window. Render nothing on the server.
const subscribeHost = () => () => {};
const getControls = () => window.piDesktopHost?.windowControls;
const serverControls = () => undefined;

export function DesktopWindowControls() {
  const { t } = useI18n();
  const controls = useSyncExternalStore(subscribeHost, getControls, serverControls);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    let useInitialState = true;
    const unsubscribe = controls.onState((state) => {
      useInitialState = false;
      setMaximized(state.maximized);
    });
    // A delayed initial IPC reply must not overwrite a newer state event.
    void controls.getState().then((state) => {
      if (useInitialState) setMaximized(state.maximized);
    }, () => {});
    return () => { useInitialState = false; unsubscribe(); };
  }, [controls]);

  if (!controls) return null;
  const button = (action: WindowAction, label: string, path: string) => (
    <button type="button" data-window-action={action}
      data-maximized={action === "toggle-maximize" ? String(maximized) : undefined}
      aria-label={label} title={label} onClick={() => controls.run(action)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
    </button>
  );
  return (
    <div data-window-controls="">
      {button("minimize", t("window.minimize"), "M5.5 14.5h13")}
      {button("toggle-maximize", t(maximized ? "window.restore" : "window.maximize"),
        maximized ? "M8.5 7.5V6a2 2 0 0 1 2-2H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-1.5M6.8 8.5h6.4a2.3 2.3 0 0 1 2.3 2.3v6.4a2.3 2.3 0 0 1-2.3 2.3H6.8a2.3 2.3 0 0 1-2.3-2.3v-6.4a2.3 2.3 0 0 1 2.3-2.3z" : "M7.5 5.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z")}
      {button("close", t("window.close"), "M6.5 6.5l11 11m0-11-11 11")}
    </div>
  );
}
