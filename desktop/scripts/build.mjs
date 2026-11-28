import { Arch, Platform, build } from "electron-builder";
import fs from "node:fs";
import path from "node:path";
import { APP_ID } from "../src/identity.mjs";
import { desktopDir, outDir, releaseDir, repoDir, stageDir } from "./paths.mjs";
import { stage } from "./stage.mjs";

// Builds the app: stages the payload (scripts/stage.mjs), then wraps the shell
// and the payload into one program.
//
//   node scripts/build.mjs           the installer, copied to release/
//   node scripts/build.mjs --dir     only the unpacked app, for scripts/verify.mjs
//   --skip-build                     reuse pi-web's existing build in .next
//   --skip-stage                     reuse the payload staged last time

const dirOnly = process.argv.includes("--dir");
const skipStage = process.argv.includes("--skip-stage");

function log(message) {
  console.log(`[build] ${message}`);
}

/** Puts the payload into the app's resources, exactly as staged. */
function copyPayload(context) {
  const resources = path.join(context.appOutDir, "resources");
  const startedAt = Date.now();
  for (const name of ["server", "node", "build.json"]) {
    fs.cpSync(path.join(stageDir, name), path.join(resources, name), { recursive: true });
  }
  log(`payload copied in ${Math.round((Date.now() - startedAt) / 1000)} s`);
}

if (skipStage) {
  if (!fs.existsSync(path.join(stageDir, "build.json"))) throw new Error("Nothing is staged yet: run without --skip-stage");
  log("reusing the staged payload (--skip-stage)");
} else {
  await stage({ skipBuild: process.argv.includes("--skip-build") });
}

const { version } = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));
const installerName = `PiWebDesktop-Setup-${version}.exe`;

await build({
  projectDir: desktopDir,
  targets: Platform.WINDOWS.createTarget(dirOnly ? "dir" : "nsis", Arch.x64),
  publish: "never",
  config: {
    appId: APP_ID,
    directories: { output: outDir },
    electronLanguages: ["en-US", "zh-CN", "zh-TW"],
    files: ["package.json", "src/**"],
    // The shell has no dependencies of its own to install or compile.
    npmRebuild: false,
    afterPack: copyPayload,
    // rcedit from a plain zip: the default bundle holds symbolic links, which
    // Windows only lets an administrator or Developer Mode unpack.
    toolsets: { winCodeSign: "1.1.0" },
    win: {
      // pi-web's own icon, so the app follows it.
      icon: path.join(repoDir, "public", "icons", "icon-512.png"),
    },
    nsis: {
      // One click, for the current user: the server rewrites files in its own
      // folder at each start (bin/rotate-preview-secrets.js), which a
      // per-machine install under Program Files would refuse.
      oneClick: true,
      perMachine: false,
      artifactName: installerName,
      // ZIP extracts into the install directory, skipping the staging copy used by 7z.
      useZip: true,
      differentialPackage: false,
      // Uninstalling leaves the window state and, always, pi's own ~/.pi.
      deleteAppDataOnUninstall: false,
    },
  },
});

if (dirOnly) {
  log(`unpacked app: ${path.join(outDir, "win-unpacked")}`);
} else {
  fs.mkdirSync(releaseDir, { recursive: true });
  const installer = path.join(releaseDir, installerName);
  fs.copyFileSync(path.join(outDir, installerName), installer);
  log(`installer: ${installer} (${Math.round(fs.statSync(installer).size / 1024 / 1024)} MB)`);
}
