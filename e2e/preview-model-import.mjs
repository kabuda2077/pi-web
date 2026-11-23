// Start via the isolated-model-import preview configuration. This project mounts
// the real editor, but has no production routes, instrumentation or .env files.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 30243);
const dir = path.join(repo, "test-results", "model-import-next");
const home = path.join(dir, "home");
fs.mkdirSync(home, { recursive: true });
for (const key of Object.keys(process.env)) {
  if (!/^(path|systemroot|windir|comspec|pathext|temp|tmp|number_of_processors|processor_architecture)$/i.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
  PI_CODING_AGENT_DIR: path.join(home, "agent"), NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "development", NODE_OPTIONS: `--require="${path.join(repo, "e2e/model-import-offline.cjs").replaceAll("\\", "/")}"`,
});
await import("./model-import-offline.cjs");
process.chdir(dir);
fs.mkdirSync("app", { recursive: true });
fs.writeFileSync("package.json", JSON.stringify({ name: "model-import-preview", private: true }));
fs.writeFileSync("instrumentation.js", "export function register() {}\n");
fs.writeFileSync("proxy.js", "export function proxy() { return; }\n");
fs.writeFileSync("next.config.mjs", `export default ${JSON.stringify({ turbopack: { root: repo }, devIndicators: false })}`);
fs.writeFileSync("tsconfig.json", JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { paths: { "@/*": ["../../*"] } }, include: ["app/**/*"] }));
fs.writeFileSync("app/layout.jsx", `import '@/app/globals.css'; import '@/app/settings.css';
export default function Layout({children}) { return <html lang="en"><body>{children}</body></html>; }`);
fs.writeFileSync("app/page.jsx", `"use client";
import {useState} from 'react'; import {I18nProvider} from '@/hooks/useI18n'; import {ModelsConfig} from '@/components/ModelsConfig';
export default function Page() { const [open,setOpen]=useState(true); return <I18nProvider>{open ? <ModelsConfig onClose={()=>setOpen(false)}/> : <button onClick={()=>setOpen(true)}>Open fixture models</button>}</I18nProvider>; }`);

const hostname = "127.0.0.1";
const next = (await import("next")).default;
const app = next({ dev: true, turbopack: true, dir, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const configs = new Map();
const importDefaults = new Map();
const base = name => `http://127.0.0.1:${port}/fixture/${name}`;
const initial = { providers: {
  alpha: { api: "openai-completions", baseUrl: base("alpha"), models: [{ id: "existing", contextWindow: 8192, maxTokens: 512, reasoning: false }, { id: "no-window" }] },
  beta: { api: "openai-responses", baseUrl: base("beta"), models: [{ id: "untouched", contextWindow: 1024 }] },
} };
const enabled = { providers: [], allEnabled: true, scope: "global", editable: true, patterns: null, stalePatterns: [], enabledTotal: 0, availableTotal: 0 };
const preset = { name: "Catalog Name", contextWindow: 131072, maxTokens: 4096, reasoning: true, input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 } };
async function json(req) { const parts = []; for await (const chunk of req) parts.push(chunk); return JSON.parse(Buffer.concat(parts).toString()); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${hostname}:${port}`);
  const send = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  if (!url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`);
    return handle(req, res);
  }
  try {
    switch (url.pathname) {
      case "/api/fixture-id": return send({ fixture: "isolated-model-import-v1" });
      case "/api/models-config": {
        const key = /\bfixture=([\da-f-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? randomUUID();
        res.setHeader("Set-Cookie", `fixture=${key}; HttpOnly; SameSite=Strict; Path=/`);
        if (req.method === "GET") return send(configs.get(key) ?? initial);
        if (req.method === "PUT") { configs.set(key, await json(req)); return send({ success: true }); }
        break;
      }
      case "/api/models-config/import-defaults": {
        const key = /\bfixture=([\da-f-]+)/.exec(req.headers.cookie ?? "")?.[1] ?? randomUUID();
        res.setHeader("Set-Cookie", `fixture=${key}; HttpOnly; SameSite=Strict; Path=/`);
        if (req.method === "PUT") importDefaults.set(key, (await json(req)).contextWindows);
        return send({ contextWindows: importDefaults.get(key) ?? {} });
      }
      case "/api/models-config/discover": {
        const { providerName } = await json(req);
        return send({ models: ["existing", "match", "missing", "offline", "override"].map(id => ({ id })), endpoint: base(providerName) });
      }
      case "/api/models-config/catalog": {
        const { ids } = await json(req);
        if (ids.includes("offline")) return send({ error: "Fixture catalog unavailable" }, 503);
        return send({ presets: ids.filter(id => ["match", "override"].includes(id)).map(id => ({ id, preset: { ...preset, name: id === "override" ? "Override Name" : preset.name } })) });
      }
      case "/api/models/enabled": return send(enabled);
      case "/api/auth/providers": return send({ oauthProviders: [], apiKeyProviders: [] });
      case "/api/provider-usage/query": return send({ providers: [] });
    }
    return send({ error: "No such fixture" }, 404);
  } catch { return send({ error: "Invalid fixture request" }, 400); }
});
server.listen(port, hostname, () => console.log(`Isolated model-import fixture at http://${hostname}:${port}`));
