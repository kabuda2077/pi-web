import { app } from "electron";
import path from "node:path";
import { PROFILE_NAME } from "./identity.mjs";

export const HOST = "127.0.0.1";

/**
 * The page's storage belongs to its origin, port included, so the server gets
 * the same port on every launch. Not pi-web's own 30141: a pi-web started from
 * a terminal keeps working beside this app.
 */
export const PREFERRED_PORT = 30171;

const SELF_TEST_FLAG = "--self-test=";
const SELF_TEST_SCENARIO_FLAG = "--self-test-scenario=";
const argument = (flag) => process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);
const selfTestArg = argument(SELF_TEST_FLAG);

/** Folder a self-test run keeps everything in (profile, agent data, report), or null. */
export const selfTestDir = selfTestArg ? path.resolve(selfTestArg) : null;

/** What a self-test checks: the app working (default), or `server-fails`: a server that cannot start. */
export const selfTestScenario = argument(SELF_TEST_SCENARIO_FLAG) ?? "works";

/** After a self-test, keep running until killed: scripts/verify.mjs then kills the app to see its server end too. */
export const selfTestHold = process.argv.includes("--self-test-hold");

export function profileDir() {
  if (selfTestDir) return path.join(selfTestDir, "profile");
  // A run from source keeps its own profile, so it can start beside the installed app.
  return path.join(app.getPath("appData"), app.isPackaged ? PROFILE_NAME : `${PROFILE_NAME}-dev`);
}

const sourceDir = import.meta.dirname;

/** Where the pieces are: inside the installed app, or in this checkout when run from source. */
export function resolvePaths() {
  const packaged = app.isPackaged;
  const serverDir = packaged ? path.join(process.resourcesPath, "server") : path.resolve(sourceDir, "..", "..");
  return {
    serverDir,
    nodePath: packaged ? path.join(process.resourcesPath, "node", "node.exe") : "node",
    loadingPage: path.join(sourceDir, "ui", "loading.html"),
    iconPath: path.join(serverDir, "public", "icons", "icon-192.png"),
  };
}
