import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// The desktop fork's Tasks entry at the top of the sidebar. The page it opens
// is checked in a browser (e2e/task-home.mjs) and in the built app.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar, activeTaskCount } = await jiti.import("./SessionSidebar.tsx");
const { DesktopSidebarContext, NO_DESKTOP_SIDEBAR } = await jiti.import("@/hooks/useDesktopSidebar");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};

/** The sidebar as the shell renders it: pi-web's own props, and what the fork adds in its context. */
function renderSidebar(desktop, props = {}) {
  const sidebar = h(SessionSidebar, { selectedSessionId: null, onSelectSession: noop, ...props });
  return renderToStaticMarkup(h(I18nProvider, null, desktop ? h(DesktopSidebarContext.Provider, { value: { ...NO_DESKTOP_SIDEBAR, ...desktop } }, sidebar) : sidebar));
}

test("Tasks marks its page, hides a zero badge and counts each active id once", () => {
  const html = renderSidebar({ taskPageOpen: true, onOpenTasks: noop }, { selectedSessionId: "older" });
  const tasksButton = html.match(/<button\b[^>]*class="[^"]*\bsidebar-tasks-entry\b[^"]*"[^>]*>/)?.[0];
  assert.ok(tasksButton, "Tasks remains a button");
  assert.match(tasksButton, /aria-current="page"/);
  assert.doesNotMatch(html, /class="sidebar-task-count"/);
  assert.equal(activeTaskCount(new Set(["one", "two"]), new Set(["two", "three"]), new Set(["three", "four"])), 4);
  // No row shows as selected under the tasks page.
  assert.match(source, /visibleSelectedId = taskPageOpen(?: \|\| tempChatDraft)? \? null : selectedSessionId/);
  // Without the entry's handler there is no entry: pi-web's sidebar.
  assert.doesNotMatch(renderSidebar(), /sidebar-tasks-entry/);
});
