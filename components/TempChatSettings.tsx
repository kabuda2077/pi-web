"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { DirectoryPicker } from "./DirectoryPicker";
import { ConfigButton } from "./SettingsUi";

async function requestRoot(options?: RequestInit): Promise<string> {
  const response = await fetch("/api/temp-chats", options);
  const data = await response.json();
  if (!response.ok || typeof data.root !== "string") throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.root;
}

export function TempChatSettings() {
  const { t } = useI18n();
  const [root, setRoot] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRoot({ signal: controller.signal }).then(setRoot).catch((e: Error) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, []);

  function close() {
    setOpen(false);
    opener.current?.focus();
  }

  async function save(path: string) {
    setSaving(true);
    setError("");
    try {
      setRoot(await requestRoot({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: path }) }));
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-general-subsection" aria-labelledby="settings-temp-chat-folder">
      <h4 className="settings-general-subheading" id="settings-temp-chat-folder">{t("settings.tempChatFolder")}</h4>
      <div className="settings-chat-options">
        <div className="settings-chat-option settings-chat-switch-option">
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{root ?? (error ? null : t("i18n.loading"))}</span>
          <ConfigButton ref={opener} size="small" disabled={root === null && !error} aria-haspopup="dialog" onClick={() => setOpen(true)}>{t("settings.chooseChatFolder")}</ConfigButton>
        </div>
      </div>
      <p className="settings-general-description">{t("settings.tempChatFolderNote")}</p>
      {error && !open && <p role="alert" className="settings-general-error">{error}</p>}
      {open && (
        // Portal events bubble through React. Keep the picker's Escape (and
        // that of its new-folder dialog) from also dismissing Settings.
        <div onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
          <DirectoryPicker busy={saving} error={error} onCancel={close} onSelect={(path) => void save(path)} />
        </div>
      )}
    </section>
  );
}
