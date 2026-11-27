import fs from "node:fs";
import path from "node:path";

/** Next stores prerendered pages without a build ID in their cache keys. */
export function prepareRouteCache(serverDir) {
  const nextDir = path.join(serverDir, ".next");
  const buildId = fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
  const cache = path.join(nextDir, "server", "route-cache");
  const stamp = path.join(cache, "pi-web-desktop-build-id");
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === buildId) return;

  // An in-place install can keep files written by an older server. Drop them
  // before the new server loads its first page or caches it in memory.
  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(stamp, buildId);
}
