// Start isolated-task-home with preview_start, then node e2e/task-home.mjs [port].
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = `http://127.0.0.1:${Number(process.argv[2] || 30245)}`;
assert.deepEqual(await (await fetch(`${origin}/api/fixture-id`, { redirect: "error" })).json(), { fixture: "isolated-task-home-v1" });
const results = fileURLToPath(new URL("../test-results/task-home/", import.meta.url));
await fs.mkdir(results, { recursive: true });
const browser = await chromium.launch({ channel: existsSync(chromium.executablePath()) ? "chromium" : "chrome",
  args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US", serviceWorkers: "block" });
page.setDefaultTimeout(12000);
const requests = [], reserved = [], unexpected = [], external = [], errors = [], checks = [];
const pass = msg => { checks.push(msg); console.log(`PASS ${msg}`); };
page.on("pageerror", err => errors.push(err.message));
page.on("console", msg => { if (msg.type() === "error" && !errors.includes(msg.text())) errors.push(msg.text()); });
page.on("response", r => {
  if (r.status() >= 400 && r.url().includes("/api/")) unexpected.push([r.status(), r.url()]);
  // The folders the page reserves for its General chats, in order: one ahead of each chat.
  if (new URL(r.url()).pathname === "/api/temp-chats" && r.request().method() === "POST") r.json().then(body => reserved.push(body.cwd), () => {});
});
page.on("request", r => {
  const p = new URL(r.url()).pathname;
  if (r.method() === "POST" && (p === "/api/default-cwd" || p === "/api/agent/new" || /^\/api\/agent\/[^/]+$/.test(p))) {
    const b = r.postDataJSON() ?? {};
    if (!b.type || !b.type.startsWith("get_")) requests.push({ path: p, ...b });
  }
});
await page.route("**/*", route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url()); return route.abort();
});
const btn = name => page.getByRole("button", { name, exact: true });
const input = page.locator("textarea.chat-input-textarea:visible");
const tasks = page.locator(".sidebar-tasks-entry");
const taskPage = page.getByRole("region", { name: "Tasks", exact: true });
const section = (key) => page.locator(`[data-row-key="${key}-header"]`);
const newChat = async () => { await section("chats").hover(); await btn("New chat").click(); };
/** Waits until the page has reserved its count-th folder, and answers it. */
const reservedFolder = async (count) => {
  for (let waited = 0; reserved.length < count; waited += 50) {
    assert.ok(waited < 12000, `${reserved.length} folders reserved, waiting for ${count}`);
    await page.waitForTimeout(50);
  }
  assert.equal(reserved.length, count, "no folder is reserved that no chat asked for");
  return reserved[count - 1];
};
const screenshot = name => page.screenshot({ path: `${results}/${name}.png` });
const newReq = () => page.waitForRequest(r => r.url() === `${origin}/api/agent/new` && r.method() === "POST");
const promptReq = () => page.waitForRequest(r => r.method() === "POST" && /^\/api\/agent\/[^/]+$/.test(new URL(r.url()).pathname) && r.postDataJSON()?.type === "prompt");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Aun8AAAAASUVORK5CYII=", "base64");
let failed;
try {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByText("Fixture Vision", { exact: true }).first().waitFor();
  await tasks.click(); await taskPage.getByRole("heading", { name: "Tasks", exact: true }).waitFor();
  const groups = page.locator("#session-sidebar-panel-sessions");
  await groups.locator('[data-row-key="session:chat:temp-history"]').waitFor();
  const projectToggle = groups.getByRole("button", { name: "Atlas", exact: true });
  if (await projectToggle.getAttribute("aria-expanded") === "false") await projectToggle.click();
  await groups.locator('[data-row-key="session:group:project-history"]').waitFor();
  assert.equal(await groups.locator('[data-row-key^="session:"]').filter({ hasText: "Quick note" }).count(), 1);
  assert.equal(await input.count(), 0);
  for (const [heading, title] of [["Needs your attention", "Review navigation draft"], ["Running", "Check project files"], ["Recent", "Quick note"]]) {
    const group = taskPage.getByRole("heading", { name: new RegExp(`^${heading}`) }).locator("..");
    await group.getByRole("button", { name: new RegExp(title) }).waitFor();
    assert.equal(await taskPage.getByRole("button", { name: new RegExp(title) }).count(), 1);
  }
  pass("Waiting, running and recent tasks appear once in the proper status group");
  assert.match(await taskPage.getByRole('button', { name: /Quick note/ }).innerText(), /General/);
  await page.keyboard.press("Escape"); await page.keyboard.press("Control+Enter");
  assert.deepEqual(requests, []); await screenshot("tasks");
  pass("Task page is read-only; regular and registered temp conversations occupy distinct sidebar groups");

  await tasks.hover();
  const labelX = async (row) => (await row.locator("span").first().boundingBox()).x;
  for (const key of ["chats", "projects"]) {
    const row = section(key), add = row.locator(".sidebar-section-add");
    const before = await labelX(row);
    assert.equal(await add.evaluate(el => getComputedStyle(el).opacity), "0");
    await row.hover();
    assert.equal(await add.evaluate(el => getComputedStyle(el).opacity), "1");
    assert.equal(await labelX(row), before);
    assert.equal(before, await labelX(tasks));
    await tasks.hover();
  }
  assert.equal(await groups.locator('[data-row-key="footer-open"]').count(), 0);
  await section("projects").locator(".sidebar-section-toggle").focus();
  await page.keyboard.press("Tab");
  assert.equal(await section("projects").locator(".sidebar-section-add").evaluate(el => el === document.activeElement && getComputedStyle(el).opacity === "1"), true);
  await page.keyboard.press("Enter"); await page.getByLabel("Project name", { exact: true }).waitFor();
  await page.keyboard.press("Escape"); await page.getByLabel("Project name", { exact: true }).waitFor({ state: "hidden" });
  await section("projects").getByRole("button", { name: "Projects", exact: true }).click();
  assert.equal(await groups.locator('[data-row-key="group:/fixture/projects/Atlas"]').count(), 0);
  pass("Peer section labels align; add buttons appear on hover without moving text, and the old footer is gone");

  await taskPage.getByRole("button", { name: /Atlas design review/ }).click();
  await page.waitForURL(url => url.searchParams.get("session") === "project-history");
  await input.waitFor(); assert.deepEqual(requests, []);
  await groups.locator('[data-row-key="session:group:project-history"]').waitFor();
  const layout = await input.evaluate(el => {
    const chat = el.closest(".chat-content");
    const style = getComputedStyle(chat);
    return { display: style.display, direction: style.flexDirection, chatBottomGap: innerHeight - chat.getBoundingClientRect().bottom, inputBottomGap: innerHeight - el.getBoundingClientRect().bottom };
  });
  assert.equal(layout.display, "flex"); assert.equal(layout.direction, "column");
  assert.ok(Math.abs(layout.chatBottomGap) <= 2 && layout.inputBottomGap >= 0 && layout.inputBottomGap < 120, JSON.stringify(layout));
  await screenshot("chat");
  pass(`Short chat fills viewport; composer textarea ends ${Math.round(layout.inputBottomGap)}px above window bottom`);
  pass("Opening a recent task navigates to its existing session without starting an agent or sending a prompt");

  await page.route(`${origin}/api/agent/debug*`, route => route.fulfill({ json: {
    now: Date.now(), sessions: [], session: null,
    server: { startedAt: Date.now(), idleTimeoutMs: 600000, heartbeatMs: 30000,
      wrappers: { alive: 0, closing: 0, starting: 0 }, eventStreams: { total: 0 }, sseTotal: 0,
      pages: [], fileWatches: 0, terminals: { count: 0, listeners: 0, detached: 0, exited: 0, nextCleanupAt: null } },
  } }));
  const debug = btn("Debug");
  await debug.click(); await page.locator(".debug-panel").waitFor();
  // The page reserved a folder as it loaded, so the composer opens with the click.
  const cwd = await reservedFolder(1);
  await newChat();
  await page.waitForURL(url => !url.searchParams.has("session"));
  await input.fill("Only a fixture draft");
  assert.equal(await debug.getAttribute("aria-pressed"), "true");
  assert.ok(await page.locator(".debug-panel").isVisible());
  await debug.click(); await page.locator(".debug-panel").waitFor({ state: "hidden" });
  pass("Debug stays open when switching from a project chat to a new General chat and can still be closed");
  await tasks.click(); assert.equal(await input.count(), 0);
  await newChat(); assert.equal(await input.inputValue(), "Only a fixture draft");
  await btn("Change tool preset").click(); await page.getByRole("button", { name: /^read-only/i }).click();
  await page.locator('.chat-input-shell:visible input[type="file"]').setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await page.locator('.chat-input-shell:visible img').first().waitFor();
  assert.deepEqual(requests, []); assert.equal(await reservedFolder(1), cwd); await screenshot("draft");
  pass("A General chat opens in the folder reserved ahead; reopening the draft keeps its text and folder; tools and an image start nothing");

  const [newAgent, prompt] = await Promise.all([newReq(), promptReq(), input.press("Enter")]);
  const agentBody = newAgent.postDataJSON(); const promptBody = prompt.postDataJSON();
  assert.equal(agentBody.cwd, cwd); assert.equal(agentBody.type, "ensure_session");
  assert.deepEqual(agentBody.toolNames, ["read", "grep", "find", "ls"]);
  assert.equal(promptBody.message, "Only a fixture draft"); assert.equal(promptBody.images.length, 1);
  assert.equal(promptBody.images[0].mimeType, "image/png"); assert.equal(promptBody.images[0].data, png.toString("base64"));
  assert.deepEqual(requests.map(x => x.path), ["/api/agent/new", new URL(prompt.url()).pathname]);
  const id = new URL(prompt.url()).pathname.split("/").at(-1);
  await page.locator(`[data-row-key="session:chat:${id}"]`).waitFor();
  const next = await reservedFolder(2);
  assert.notEqual(next, cwd);
  pass("The first send creates the standard agent in the reserved folder with the selected tools, sends text and image, and the next folder is reserved");

  const group = groups.locator('[data-row-key="group:/fixture/projects/Atlas"]'); await group.hover();
  await group.getByRole("button", { name: /^New session in / }).click();
  await input.fill("Normal project fixture");
  const [projectNew, projectPrompt] = await Promise.all([newReq(), promptReq(), input.press("Enter")]);
  assert.equal(projectNew.postDataJSON().cwd, "/fixture/projects/Atlas");
  assert.equal(projectPrompt.postDataJSON().message, "Normal project fixture");
  assert.equal(await reservedFolder(2), next);
  pass("The normal project flow still uses the original project cwd and reserves no chat folder");
  await section("projects").hover(); await btn("New project").click();
  await page.getByLabel("Project name", { exact: true }).fill("Notebook");
  await page.locator("#new-project-parent").click(); await btn("Select this folder").click();
  const mkdir = page.waitForResponse(r => r.request().method() === "POST" && r.url() === `${origin}/api/cwd/browse`);
  await btn("Create project").click();
  const created = await (await mkdir).json(); assert.ok(created.success);
  const notebook = groups.locator(`[data-row-key="group:${created.path}"]`);
  await notebook.waitFor();
  for (const width of [1600, 980, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const edges = await input.evaluate(el => {
      let card = el.parentElement;
      while (card && !parseFloat(getComputedStyle(card).borderLeftWidth)) card = card.parentElement;
      const left = n => n.getBoundingClientRect().left;
      return { card: left(card), logo: left(document.querySelector('.new-session-logo')),
        folder: left(document.querySelector('.new-session-context svg')), text: left(el) };
    });
    assert.ok(Math.abs(edges.logo - edges.card) < 1 && Math.abs(edges.folder - edges.card) < 1 && edges.text > edges.card, JSON.stringify({width, ...edges}));
    if (width === 1600) await page.locator('.new-session-hero').locator('..').screenshot({ path: `${results}/composer-alignment.png` });
  }
  pass("Brand, project icon and input border share one left edge on wide and narrow windows");
  await newChat(); await page.locator('[data-row-key="chat-draft"]').waitFor();
  await notebook.waitFor();
  const leftUnused = await reservedFolder(2);
  pass("Projects + creates a named project that survives leaving its empty composer");
  const headerNew = page.locator(".sidebar-new-button");
  assert.equal(await headerNew.innerText(), "New conversation");
  const openTask = async (title, sessionId) => {
    await tasks.click(); await taskPage.getByRole("button", { name: new RegExp(title) }).click();
    await page.waitForURL(url => url.searchParams.get("session") === sessionId);
  };
  const headerSend = async (text) => {
    await headerNew.click(); await page.waitForURL(url => !url.searchParams.has("session"));
    await input.fill(text);
    const [agent, prompt] = await Promise.all([newReq(), promptReq(), input.press("Enter")]);
    assert.equal(prompt.postDataJSON().message, text);
    await page.waitForURL(url => url.searchParams.get("session") === new URL(prompt.url()).pathname.split("/").at(-1));
    return agent.postDataJSON().cwd;
  };
  await openTask("Atlas design review", "project-history");
  assert.equal(await headerSend("Created by the project header"), "/fixture/projects/Atlas");
  await tasks.click();
  const taskCwd = await headerSend("Independent from tasks");
  await openTask("Quick note", "temp-history");
  const chatCwd = await headerSend("Independent from another chat");
  // The chat opened above and left unsent kept its folder: the next chat starts there, and each chat started reserves the one after.
  assert.equal(taskCwd, leftUnused); assert.equal(chatCwd, reserved[2]);
  const unsent = await reservedFolder(4);
  assert.ok([taskCwd,chatCwd].every(path => path.startsWith("/fixture/agent/temp-chats/") && !path.endsWith("/history")));
  assert.notEqual(taskCwd, chatCwd);
  await newChat(); await input.fill("Keep unsent text"); await headerNew.click(); assert.equal(await input.inputValue(), "Keep unsent text");
  pass("Header starts a conversation in the current project or a separate new directory from tasks and chats; an open draft keeps its text");
  await page.evaluate(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.reload();
  // The page that went away gave back the folder its draft never used: the new page holds the same one.
  assert.equal(await reservedFolder(5), unsent); await section("projects").getByRole("button", { name: "项目", exact: true }).waitFor();
  await tasks.click();
  const gap = async (above,below) => {const a = await above.boundingBox(), b = await below.boundingBox(); return Math.round(b.y - a.y - a.height);};
  // The sizes of the gaps between blocks down the column, from the Tasks entry to the last row. Rows of one block have none.
  const columnGaps = () => page.evaluate(() => {
    const boxes = [document.querySelector(".sidebar-tasks-entry"), ...document.querySelectorAll(".session-tree-row")].map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    return [...new Set(boxes.slice(1).map((box, index) => Math.round(box.top - boxes[index].bottom)).filter(Boolean))].sort((a, b) => a - b);
  });
  const chats = section("chats"), projects = section("projects");
  const projectRows = groups.locator('[data-row-key^="group:"]');
  const firstProject = projectRows.first();
  assert.ok(await projectRows.count() > 1);
  assert.equal(await gap(tasks, chats), 6);
  assert.equal(await tasks.evaluate(el => parseFloat(getComputedStyle(el).marginTop)), 6);
  assert.equal(await gap(chats, groups.locator('[data-row-key^="session:chat:"]').first()), 0);
  assert.equal(await gap(groups.locator('[data-row-key^="session:chat:"]').last(), projects), 6);
  assert.equal(await gap(projects, firstProject), 4);
  assert.deepEqual(await columnGaps(), [4, 6]);
  await chats.getByRole("button", { name: "通用", exact: true }).click();
  assert.equal((await projects.locator('.sidebar-section-toggle svg').boundingBox()).width, 16);
  assert.equal(await labelX(chats), await labelX(projects));
  assert.equal(await gap(chats, projects), 6);
  for (const row of [tasks, chats, projects, firstProject]) assert.equal((await row.boundingBox()).height, 28);
  assert.deepEqual(await columnGaps(), [4, 6]);
  await projects.getByRole("button", { name: "项目", exact: true }).click();
  await page.mouse.move(800,100);
  await page.locator(".session-sidebar").screenshot({ path: `${results}/sidebar-compact-zh.png` });
  pass("Tasks, General, Projects and the projects are rows of one height; the entries are 6px apart, the projects 4px below Projects and apart");
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unexpected, []);
  pass("No uncaught page errors, failed API responses, or outside browser requests");
} catch (err) { failed = String(err?.stack ?? err); await screenshot("failure").catch(() => {}); throw err; }
finally {
  await fs.writeFile(`${results}/results.json`, JSON.stringify({ time: new Date().toISOString(), passed: !failed, checks, failed, errors, unexpected, external, requests }, null, 2));
  await browser.close();
}
