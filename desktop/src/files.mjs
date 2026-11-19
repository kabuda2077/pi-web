import fs from "node:fs";
import path from "node:path";

const MAX_PATH_LENGTH = 4096;
const DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * The Windows path of a file the page names (pi-web writes `D:/work/a.md`), or
 * null when the shell must not touch it. Chat text comes from a model, so only
 * a path on a drive letter passes: looking at a UNC path (`\\host\share\a.md`)
 * makes Windows sign in to whatever server it names.
 */
export function localFilePath(value) {
  if (typeof value !== "string" || value.length > MAX_PATH_LENGTH || value.includes("\0")) return null;
  if (!DRIVE_PATH.test(value)) return null;
  const normalized = path.win32.normalize(value);
  // `D:\work\` names the folder `D:\work`; a drive's root keeps its backslash.
  return normalized.length > 3 ? normalized.replace(/\\+$/, "") : normalized;
}

/**
 * What Explorer shows for a file: the file selected in its folder, or, when
 * the file is gone, the folder it was in. Null when that is gone too.
 *
 * @param {string} filePath From localFilePath()
 * @returns {{ select: string } | { open: string } | null}
 */
export function revealTarget(filePath, exists = fs.existsSync) {
  if (exists(filePath)) return { select: filePath };
  const folder = path.win32.dirname(filePath);
  return folder !== filePath && exists(folder) ? { open: folder } : null;
}
