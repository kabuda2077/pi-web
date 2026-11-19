import path from "node:path";

export const desktopDir = path.resolve(import.meta.dirname, "..");
/** The pi-web checkout this folder lives in. */
export const repoDir = path.resolve(desktopDir, "..");

// Everything a build produces on the way stays under node_modules: pi-web's own
// lint, type check and Tailwind scan cover the whole repository and skip only
// that folder, so nothing in pi-web has to learn about this one.
export const workDir = path.join(desktopDir, "node_modules", ".cache", "build");
/** The payload the app carries: `server/` (pi-web as its npm package holds it, with its dependencies) and `node/`. */
export const stageDir = path.join(workDir, "stage");
/** electron-builder's output. */
export const outDir = path.join(workDir, "dist");
/** Where the finished installer is put. */
export const releaseDir = path.join(desktopDir, "release");

/**
 * The Node.js the app carries for its server: the 22 LTS line pi-web's own CI
 * and Docker image run on. Checksum from https://nodejs.org/dist/v<version>/SHASUMS256.txt.
 */
export const NODE_RUNTIME = {
  version: "22.23.5",
  file: "node-v22.23.5-win-x64.zip",
  sha256: "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3",
};
