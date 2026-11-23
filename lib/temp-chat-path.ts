/** One spelling per folder: Windows paths differ in slashes and case only. */
export function tempChatPathKey(value: string): string {
  const key = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(key) || key.startsWith("//") ? key.toLowerCase() : key;
}

const indexes = new WeakMap<readonly string[], Set<string>>();

/** Only an explicitly allocated directory is a chat, never an arbitrary child of the root. */
export function isTempChatCwd(cwd: string | undefined | null, cwds: readonly string[]): boolean {
  if (!cwd) return false;
  let index = indexes.get(cwds);
  if (!index) {
    index = new Set(cwds.map(tempChatPathKey));
    indexes.set(cwds, index);
  }
  return index.has(tempChatPathKey(cwd));
}
