import fs from "node:fs";
import path from "node:path";

/** Find the installed npm package without relying on its exports exposing package.json. */
function dependencyPath(project, from, name) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === project) return null;
  }
}

/** Restore packages which load providers, plugins or native files at runtime. */
export function stageRuntimePackages(project, target, names) {
  const pending = names.map(name => ({ name, from: project, optional: false }));
  const copied = new Set();
  for (const { name, from, optional } of pending) {
    const source = dependencyPath(project, from, name);
    if (!source && optional) continue;
    if (!source) throw new Error(`Missing runtime dependency ${name} of ${path.relative(project, from) || "pi-web"}`);
    if (copied.has(source)) continue;
    copied.add(source);

    const dest = path.join(target, path.relative(project, source));
    const nativePrebuilds = path.join(source, "prebuilds");
    fs.cpSync(source, dest, {
      recursive: true,
      filter: entry => {
        const parts = path.relative(source, entry).split(path.sep);
        if (parts[0] === "node_modules") return false;
        if (name === "node-pty" && path.dirname(entry) === nativePrebuilds) return parts[1] === "win32-x64";
        return true;
      },
    });

    const { dependencies, optionalDependencies } = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    for (const dependency of Object.keys({ ...dependencies, ...optionalDependencies })) {
      pending.push({ name: dependency, from: source, optional: Object.hasOwn(optionalDependencies ?? {}, dependency) });
    }
  }
  return copied.size;
}
