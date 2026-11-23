import { randomUUID } from "node:crypto";
import { applySessionUiStateRequest } from "../lib/session-ui-state-shared.ts";
const project = "/fixture/projects/Atlas";
const tempRoot = "/fixture/agent/temp-chats";
const model = { provider: "fixture", modelId: "local-model" };
const samples = [{ id: model.modelId, name: "Fixture Vision", provider: model.provider, providerName: "Fixture", input: ["text", "image"] }];
function record(id, cwd, name) {
  return { id, path: `/fixture/sessions/${id}.jsonl`, cwd, name, projectKey: cwd, projectRoot: cwd,
    created: new Date().toISOString(), modified: new Date().toISOString(), messageCount: 1, firstMessage: name };
}
export function makeSpace() {
  return { sessions: [record("project-history", project, "Atlas design review"), record("temp-history", `${tempRoot}/history`, "Quick note"),
    record("waiting-task", project, "Review navigation draft"), record("running-task", project, "Check project files")],
    projects: new Set([project]), allocated: [`${tempRoot}/history`], held: new Map(), live: new Set(), streams: new Map(), ui: { version: 1, revision: 0, projects: {}, sessions: {} } };
}
function context(s) { return { messages: [{ role: "user", content: s.firstMessage }], entryIds: ["fixture-entry"], oldestEntryId: "fixture-entry", hasMore: false, turnsBefore: 0, model, thinkingLevel: "off" }; }
async function readBody(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
export async function fixtureApi(req, res, u, st) {
  const send = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  try {
    const b = req.method === "POST" ? await readBody(req) : {};
    const p = u.pathname;
    const list = { sessionListVersion: st.sessions.length, runningSessionIds: ["waiting-task", "running-task"], awaitingInputSessionIds: ["waiting-task"], subagentsActiveSessionIds: [], completionNotificationSuppressedSessionIds: [], serverNow: Date.now(), sessionUiStateRevision: st.ui.revision };
    if (p === "/api/fixture-id") return send({ fixture: "isolated-task-home-v1" });
    if (p === "/api/sessions") return send({ ...list, sessions: st.sessions });
    if (p === "/api/agent/running") return send(list);
    if (p === "/api/sessions/ui-state") {
      if (req.method === "POST") st.ui = applySessionUiStateRequest(st.ui, b, Date.now()).state;
      return send({ state: st.ui });
    }
    if (p === "/api/models") return send({ models: { "fixture:local-model": "Fixture Vision" }, modelList: samples, defaultModel: model, defaultThinkingLevel: "off", thinkingLevels: { "fixture:local-model": ["off"] }, thinkingLevelMaps: {}, thinkingLevelPins: {}, isScoped: false });
    if (p === "/api/home") return send({ home: "/fixture", homeDir: "/fixture" });
    if (p === "/api/temp-chats" && req.method === "GET") return send({ root: tempRoot, cwds: st.allocated });
    if (p === "/api/temp-chats" && req.method === "POST") {
      // The real route's rule: a holder keeps its folder until a session has it, and nobody shares one.
      const holder = u.searchParams.get("holder") ?? randomUUID();
      const unused = dir => !st.sessions.some(row => row.cwd === dir);
      const mine = st.held.get(holder);
      st.held.delete(holder);
      const others = new Set(st.held.values());
      let cwd = mine && unused(mine) ? mine : st.allocated.find(dir => !others.has(dir) && unused(dir));
      if (!cwd) st.allocated.push(cwd = `${tempRoot}/${randomUUID()}`);
      st.held.set(holder, cwd);
      return send({ cwd });
    }
    if (p === "/api/temp-chats" && req.method === "DELETE") { st.held.delete(u.searchParams.get("holder")); return send({ released: true }); }
    if (p === "/api/agent/new" && req.method === "POST") {
      if (!st.projects.has(b.cwd) && !st.allocated.includes(b.cwd)) return send({ error: "Fixture cwd not allocated" }, 400);
      const id = randomUUID(); st.live.add(id); st.sessions.unshift(record(id, b.cwd, b.message || "Fixture prompt"));
      return send({ success: true, sessionId: id, model, thinkingLevel: "off", data: null });
    }
    const s = st.sessions.find(row => row.id === p.split("/")[3]);
    if (p.startsWith("/api/sessions/") && s) {
      if (p.endsWith("/state")) return send({ running: false, state: null });
      if (p.endsWith("/auto-name")) return send({ name: s.name });
      return send({ sessionId: s.id, filePath: s.path, info: s, leafId: "fixture-entry", tree: [], treeFormat: "summary", snapshotRevision: "fixture", context: context(s), totalActiveMs: 0 });
    }
    if (p.startsWith("/api/agent/") && s) {
      if (p.endsWith("/events")) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
        res.write('data: {"type":"connected","isStreaming":false}\n\n');
        if (!st.streams.has(s.id)) st.streams.set(s.id, new Set());
        const streams = st.streams.get(s.id); streams.add(res); req.on("close", () => streams.delete(res)); return;
      }
      if (b.type === "prompt") {
        s.firstMessage = s.name = b.message;
        for (const stream of st.streams.get(s.id) ?? []) stream.write('data: {"type":"agent_end","messages":[]}\n\n');
      }
      if (req.method === "POST" && !p.endsWith("/lease")) return send({ success: true, data: b.type === "get_commands" ? { commands: [] } : {} });
      return send({ running: st.live.has(s.id), awaitingInput: false, subagentsActive: false, state: { isStreaming: false, isPromptRunning: false, model: samples[0], thinkingLevel: "off" } });
    }
    if (p === "/api/cwd/validate") return send({ success: true, cwd: b.cwd, projectRoot: b.cwd, projectKey: b.cwd });
    if (p === "/api/cwd/browse" && req.method === "POST") {
      const path = `${b.path}/${b.name}`;
      if (st.projects.has(path)) return send({ error: "Folder already exists" }, 409);
      st.projects.add(path);
      return send({ success: true, path });
    }
    if (p === "/api/cwd/browse") return send({ path: u.searchParams.get("path") || "/fixture/projects", directories: [], parentPath: null });
    if (p === "/api/project-trust") return send({ trusted: true, hasMcpConfig: false });
    if (p.startsWith("/api/files/")) return send({ files: [], entries: [] });
    if (p === "/api/git/status") return send({ files: [], isGitRepo: false });
    if (p === "/api/worktrees") return send({ worktrees: [], projectRoot: project });
    if (p === "/api/sessions/stats") return send({ stats: {} });
    if (p === "/api/push/config") return send({ enabled: false });
    if (p === "/api/open-in-explorer") return send({ available: false });
    if (p === "/api/app-update") return send({ current: "0.17.0", latest: "0.17.0" });
    if (p === "/api/web-auth") return send({ enabled: false });
    if (p === "/api/cache-miss-notices" && req.method === "GET") return send({ enabled: false });
    if (p === "/api/tools/settings" && req.method === "GET") return send({ isWindows: true, powerShellEnabled: true, builtinTools: ["read", "bash", "edit", "write"] });
    if (p === "/api/file-index") return send({ files: [] });
    return send({ error: `Not available in task fixture: ${p}` }, 404);
  } catch (err) { return send({ error: String(err) }, 500); }
}
