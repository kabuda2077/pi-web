import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoDir } from "./paths.mjs";

function createRoot() {
  const checkout = fs.realpathSync(repoDir);
  const protectedDirs = [checkout, os.userInfo().homedir, os.homedir(), process.env.HOME, process.env.USERPROFILE]
    .filter((dir) => dir && fs.statSync(dir, { throwIfNoEntry: false })).map((dir) => fs.realpathSync(dir));
  const override = process.env.PI_WEB_UPSTREAM_TEST_ROOT;
  const candidates = override ? [override] : [path.dirname(checkout), os.tmpdir()];
  const reasons = [];
  for (const candidate of new Set(candidates)) {
    try {
      if (!path.isAbsolute(candidate)) throw new Error("not an absolute path");
      const parent = fs.realpathSync(candidate);
      for (const dir of protectedDirs) {
        const rel = path.relative(dir, parent);
        if (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`)) {
          throw new Error(`inside the checkout or user profile (${dir})`);
        }
      }
      for (let dir = parent; ; dir = path.dirname(dir)) {
        for (const marker of [".agents/skills", ".git", "node_modules"]) {
          const entry = path.join(dir, marker);
          if (fs.lstatSync(entry, { throwIfNoEntry: false })) throw new Error(`ancestor contains ${entry}`);
        }
        if (path.dirname(dir) === dir) break;
      }
      return fs.mkdtempSync(path.join(parent, "pi-web-tests-"));
    } catch (error) {
      reasons.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`No safe writable upstream test root. Set PI_WEB_UPSTREAM_TEST_ROOT to an existing absolute directory outside your profile and checkout, with no .agents/skills, .git or node_modules in its ancestry.\n${reasons.join("\n")}`);
}

export async function withUpstreamTestEnv(run) {
  const root = createRoot();
  try {
    const home = path.join(root, "home");
    const temp = path.join(root, "tmp");
    fs.mkdirSync(home);
    fs.mkdirSync(temp);
    // Allowlist launch essentials: Pi, Node, Git and XDG overrides may point back to live data.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|PATHEXT|SystemRoot|windir|ComSpec|ProgramFiles(?:\(x86\))?|ProgramW6432|SystemDrive|LANG|LC_\w+|TZ)$/i.test(key)));
    Object.assign(env, { HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp });
    if (process.platform === "win32") {
      env.HOMEDRIVE = path.parse(home).root.slice(0, -1);
      env.HOMEPATH = home.slice(env.HOMEDRIVE.length);
      env.APPDATA = path.join(home, "AppData", "Roaming");
      env.LOCALAPPDATA = path.join(home, "AppData", "Local");
      for (const dir of [env.APPDATA, env.LOCALAPPDATA]) fs.mkdirSync(dir, { recursive: true });
    }
    return await run(env);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}
