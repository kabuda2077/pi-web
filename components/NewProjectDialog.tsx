import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useNewProjectFolder, type ProjectFolder } from "@/hooks/useNewProjectFolder";
import { DirectoryPicker } from "./DirectoryPicker";

export function NewProjectDialog({ onRegister, onOpen, onCancel }: {
  onRegister: (folder: ProjectFolder) => Promise<boolean>;
  onOpen: (folder: ProjectFolder) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const form = useNewProjectFolder(onRegister, onOpen, onCancel);
  const [choosing, setChoosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const wasChoosing = useRef(false);
  useLayoutEffect(() => {
    if (choosing) { wasChoosing.current = true; return; }
    const panel = dialog.current;
    panel?.showModal();
    (wasChoosing.current ? chooseButton : nameInput).current?.focus();
    return () => panel?.close();
  }, [choosing]);
  if (choosing) return <DirectoryPicker parentPicker initialPath={form.parent || undefined}
    onSelect={(path) => { form.setParent(path); setChoosing(false); }} onCancel={() => setChoosing(false)} />;
  return <dialog ref={dialog} className="new-project-dialog" aria-modal="true" aria-labelledby="new-project-title"
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (event.nativeEvent.isComposing || event.keyCode === 229) event.preventDefault(); } }}
    onCancel={(event) => { event.preventDefault(); form.cancel(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void form.submit(); }}>
      <h2 id="new-project-title">{t("newProject.title")}</h2>
      <label htmlFor="new-project-name">{t("newProject.name")}</label>
      <input id="new-project-name" ref={nameInput} autoComplete="off" spellCheck={false} value={form.name}
        readOnly={form.busy || !!form.created} onChange={(event) => form.setName(event.target.value)} />
      <label htmlFor="new-project-parent">{t("newProject.parent")}</label>
      <button id="new-project-parent" type="button" className="new-project-path" title={form.parent || undefined}
        disabled={form.busy || !!form.created} ref={chooseButton} onClick={() => setChoosing(true)}>
        {form.parent || t("newProject.chooseParent")}
      </button>
      {form.error && <p role="alert">{t(form.error, { path: form.created })}</p>}
      <footer>
        <button type="button" onClick={form.cancel} disabled={form.busy}>{t("i18n.cancel")}</button>
        <button type="submit" disabled={!form.name.trim() || !form.parent || form.busy}>
          {t(form.busy ? "i18n.checking" : form.created ? "newProject.retryOpen" : "newProject.create")}
        </button>
      </footer>
    </form>
  </dialog>;
}
