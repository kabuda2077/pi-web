import { useEffect, useRef, useState } from "react";
import { createDirectory } from "@/lib/directory-client";

export type ProjectFolder = { cwd: string; projectRoot: string; projectKey: string };

export function useNewProjectFolder(onRegister: (folder: ProjectFolder) => Promise<boolean>, onOpen: (folder: ProjectFolder) => void, onCancel: () => void) {
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [created, setCreated] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function submit() {
    if (!active.current || locked.current || !parent || !name.trim()) return;
    if ([".", ".."].includes(name.trim()) || /[\/\0]/.test(name)) {
      setError("newProject.invalidName");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    let path = created;
    try {
      if (!path) {
        path = await createDirectory(parent, name.trim());
        if (!active.current) return;
        setCreated(path);
      }
      // Retry only the open after mkdir succeeded. Never trust a project here.
      const res = await fetch("/api/cwd/validate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json() as Partial<ProjectFolder>;
      if (!res.ok || !data.cwd || !data.projectKey || !data.projectRoot) throw new Error("validation failed");
      if (!active.current) return;
      const folder = { cwd: data.cwd, projectKey: data.projectKey, projectRoot: data.projectRoot };
      if (!await onRegister(folder)) throw new Error("registration failed");
      if (active.current) onOpen(folder);
    } catch (cause) {
      if (!active.current) return;
      const status = cause && typeof cause === "object" && "status" in cause ? cause.status : null;
      setError(path ? "newProject.openFailed" : status === 409 ? "newProject.exists" : status === 400 ? "newProject.invalidName" : "newProject.createFailed");
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  return {
    parent, name, created, busy, error, submit,
    setParent: (value: string) => { setParent(value); setError(""); },
    setName: (value: string) => { setName(value); setError(""); },
    cancel: () => { if (!locked.current) { active.current = false; onCancel(); } },
  };
}
