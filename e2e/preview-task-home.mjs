// Real AppShell without production API routes, remote fonts or service workers.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeSpace, fixtureApi } from "./task-home-fixture.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(repo, "test-results/task-home-next");
const home = path.join(dir, "home");
const port = Number(process.env.PORT || 30245);
fs.mkdirSync(home, { recursive: true });
for (const key of Object.keys(process.env)) {
  if (!/^(path|systemroot|windir|comspec|pathext|temp|tmp|number_of_processors|processor_architecture)$/i.test(key)) delete process.env[key];
}
Object.assign(process.env, { HOME: home, USERPROFILE: home, LOCALAPPDATA: home, APPDATA: home,
  PI_CODING_AGENT_DIR: path.join(home, "agent"), NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development",
  NODE_OPTIONS: `--require="${path.join(repo, "e2e/model-import-offline.cjs").replaceAll("\\", "/")}"` });
await import("./model-import-offline.cjs");
process.chdir(dir);
fs.mkdirSync("app", { recursive: true });
fs.writeFileSync("package.json", '{"name":"task-home-preview","private":true}');
// Next builds this fixture in a separate root; scan the real component sources.
fs.writeFileSync("postcss.config.mjs", `import config from "../../postcss.config.mjs";\nexport default { ...config, plugins: { ...config.plugins, "@tailwindcss/postcss": { ...config.plugins["@tailwindcss/postcss"], base: ${JSON.stringify(repo)} } } };\n`);
fs.writeFileSync("proxy.js", "export function proxy() {}\n");
fs.writeFileSync("instrumentation.js", "export function register() {}\n");
fs.writeFileSync("next.config.mjs", `export default ${JSON.stringify({ turbopack: { root: repo }, devIndicators: false })}`);
fs.writeFileSync("tsconfig.json", JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { paths: { "@/*": ["../../*"] } }, include: ["app/**/*"] }));
const styles = Array.from(fs.readFileSync(path.join(repo, "app/layout.tsx"), "utf8").matchAll(/^import "(.+\.css)";/gm), m => `import ${JSON.stringify(m[1].replace(/^\.\//, "@/app/"))};`).join("\n");
fs.writeFileSync("app/layout.jsx", `${styles}\nexport default function Layout({children}) {return <html lang="en" translate="no" className="notranslate" suppressHydrationWarning><body translate="no" className="notranslate" suppressHydrationWarning>{children}</body></html>}`);
fs.writeFileSync("app/page.jsx", "export { default } from '@/app/page';\n");
fs.cpSync(path.join(repo, "public/icons"), "public/icons", { recursive: true });
fs.copyFileSync(path.join(repo, "public/provider-icons.svg"), "public/provider-icons.svg");

const hostname = "127.0.0.1";
const next = (await import("next")).default;
const app = next({ dev: true, turbopack: true, dir, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const spaces = new Map();
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${hostname}:${port}`);
  const key = /\bfixtureTask=([\da-f-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? randomUUID();
  if (!spaces.has(key)) spaces.set(key, makeSpace());
  res.setHeader("Set-Cookie", `fixtureTask=${key}; HttpOnly; SameSite=Strict; Path=/`);
  if (u.pathname.startsWith("/api/")) return fixtureApi(req, res, u, spaces.get(key));
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; worker-src 'self' blob:`);
  return handle(req, res);
});
server.listen(port, hostname, () => console.log(`Isolated AppShell at http://${hostname}:${port}`));
