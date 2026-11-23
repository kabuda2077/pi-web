/** Creates one child only; never adopts an existing file or directory. */
export async function createDirectory(parentPath: string, name: string): Promise<string> {
  const response = await fetch("/api/cwd/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: parentPath, name }),
  });
  const data = await response.json() as { path?: string; error?: string };
  if (!response.ok || data.error || !data.path) {
    throw Object.assign(new Error(data.error ?? `HTTP ${response.status}`), { status: response.status });
  }
  return data.path;
}
