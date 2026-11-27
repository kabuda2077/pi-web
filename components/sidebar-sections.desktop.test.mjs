import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

// The desktop fork's sections of the sidebar: General and Projects, their rows
// in the session tree, and the header's button once General chats are on.
// pi-web's own sidebar tests render the sidebar without any of it.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");
const { DesktopSidebarContext, NO_DESKTOP_SIDEBAR } = await jiti.import("@/hooks/useDesktopSidebar");
const { SessionTree } = await jiti.import("./SessionTree.tsx");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The sidebar as the shell renders it: pi-web's own props, and what the fork adds in its context. */
function renderSidebar(desktop, props = {}) {
  const sidebar = h(SessionSidebar, { selectedSessionId: null, onSelectSession: noop, ...props });
  return decode(renderToStaticMarkup(h(I18nProvider, null, desktop ? h(DesktopSidebarContext.Provider, { value: { ...NO_DESKTOP_SIDEBAR, ...desktop } }, sidebar) : sidebar)));
}

const treeDefaults = {
  rows: [], layout: "desktop", emptyLabel: null, loading: false, error: null, renamingRootId: null, confirmDeleteRootId: null, activeMenuRowKey: null,
  onSelectFamily: noop, onToggleGroup: noop, onShowMore: noop, onShowLess: noop, onTogglePinned: noop, onArchiveFamily: noop, onRestoreFamily: noop,
  onOpenRowMenu: noop, onRowContextMenu: noop, onRenameCommit: noop, onRenameCancel: noop, onDeleteConfirm: noop, onDeleteCancel: noop,
  onGroupNew: noop, onGroupMenu: noop, onPinEmptyGroup: noop, onOpenOtherProject: noop, onOpenArchive: noop,
  onToggleChats: noop, onNewChat: noop, onToggleProjects: noop, onNewProject: noop,
};

function renderTree(props) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(SessionTree, { ...treeDefaults, ...props }))));
}

function rowMarkup(html, key) {
  const part = html.split(/(?=<div class="session-tree-row )/).find((chunk) => chunk.includes(`data-row-key="${key}"`));
  assert.ok(part, `row ${key} not rendered`);
  return part;
}

test("the header's button starts a conversation anywhere once General chats are on, and is pi-web's New without them", () => {
  assert.match(renderSidebar({ onNewTempChat: noop }), /<span class="sidebar-new-label">New conversation<\/span>/);
  assert.match(renderSidebar(), /<span class="sidebar-new-label">New<\/span>/);
});

test("each section has a label toggle and a separate named add button even when folded", () => {
  for (const [key, label, action] of [["chats-header", "General", "New chat"], ["projects-header", "Projects", "Add project"]]) {
    for (const collapsed of [true, false]) {
      for (const [layout, height] of [["desktop", 28], ["mobile", 44]]) {
        const row = rowMarkup(renderTree({ layout, rows: [{ kind: key, key, collapsed }] }), key);
        assert.match(row, new RegExp(`height:${height}px`));
        assert.match(row, /<div\b[^>]*class="[^"]*\bsidebar-section-entry\b[^"]*"[^>]*>/);
        const buttons = [...row.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)];
        assert.equal(buttons.length, 2, `${key}: two separate buttons`);
        const [, toggle, toggleContents] = buttons[0];
        assert.match(toggle, /class="[^"]*\bsidebar-section-toggle\b/);
        assert.match(toggle, new RegExp(`aria-expanded="${!collapsed}"`));
        assert.equal(toggleContents.replace(/<[^>]+>/g, ""), label);
        const [, add, addContents] = buttons[1];
        assert.match(add, /class="[^"]*\bsidebar-section-add\b/);
        assert.match(add, new RegExp(`aria-label="${action}"`));
        assert.doesNotMatch(add, /aria-expanded/);
        assert.match(addContents, /<svg\b/);
      }
    }
  }
  // A + with nothing behind it is not shown.
  const bare = renderTree({ onNewChat: undefined, onNewProject: undefined, rows: [{ kind: "chats-header", key: "chats-header", collapsed: false }, { kind: "projects-header", key: "projects-header", collapsed: false }] });
  assert.doesNotMatch(bare, /sidebar-section-add/);
  // The folder is drawn a size up to weigh what the other two icons do.
  assert.match(rowMarkup(renderTree({ rows: [{ kind: "projects-header", key: "projects-header", collapsed: false }] }), "projects-header"), /<svg[^>]*width="16"[^>]*class="sidebar-projects-icon"|<svg[^>]*class="sidebar-projects-icon"[^>]*width="16"/);
});

test("General visibly selects the unsaved draft and links saved sessions", () => {
  const modified = new Date(Date.now() - 300_000).toISOString();
  const root = { id: "saved", path: "/sessions/saved.jsonl", cwd: "/chats/one", projectRoot: "/chats/one", projectKey: "/chats/one", created: modified, modified, messageCount: 3, firstMessage: "first saved" };
  const saved = { kind: "session", key: "session:chat:saved", family: { root, subagents: [], latestModified: modified }, context: "chat",
    project: { key: "/chats/one", root: "/chats/one", name: "one", pinned: false, current: false },
    status: { running: false, awaiting: false, unread: false, selected: false, transient: false } };
  for (const layout of ["desktop", "mobile"]) {
    const html = renderTree({ layout, rows: [{ kind: "chats-header", key: "chats-header", collapsed: false }, { kind: "chat-draft", key: "chat-draft" }, saved] });
    assert.match(rowMarkup(html, "chats-header"), /aria-expanded="true"[\s\S]*>General<\/span><\/button><button[^>]*aria-label="New chat"/);
    assert.match(rowMarkup(html, "chat-draft"), /is-selected[\s\S]*aria-current="true"/);
    assert.match(rowMarkup(html, "session:chat:saved"), /href="\?session=saved"/);
  }
});

test("opening a General chat keeps the Debug panel open, as every other way of opening a chat does", () => {
  const file = ts.createSourceFile("AppShell.tsx", shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "showTempChat") return node.initializer;
    return ts.forEachChild(node, find);
  }
  const body = find(file)?.getText(file);
  assert.ok(body, "showTempChat");
  assert.match(body, /setActiveTopPanel\(\(panel\) => panel === "debug" \? panel : null\);/);
  assert.doesNotMatch(body, /setActiveTopPanel\(null\)/);
  // It stands outside the handlers pi-web's own tests cut out of this file by name.
  for (const name of ["showTempChat", "openTempChat"]) assert.ok(shellSource.indexOf(`const ${name} = `) > shellSource.indexOf("const handleSessionCreated = "), name);
});
