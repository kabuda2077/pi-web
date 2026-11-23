import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// The desktop fork's sidebar sections in the session tree's model: General
// above Projects. pi-web's own lib/session-tree.test.mjs builds the tree
// without `chats`, which must stay pi-web's tree.
const jiti = createJiti(import.meta.url);
const {
  SIDEBAR_ROW_HEIGHTS,
  archivedFamilyIds,
  buildArchiveRows,
  buildSessionTree,
  familiesToDelete,
  getRowOffsets,
  groupBlocks,
  groupDropAt,
  locateSessionRow,
} = await jiti.import("./session-tree.ts");
const { SECTION_ROW_HEIGHTS, isSectionContent, sectionRowHeight } = await jiti.import("./sidebar-sections.ts");

const BASE = Date.parse("2026-10-01T00:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

function session(id, { project = "/work/alpha", cwd = project, modified = BASE, ...rest } = {}) {
  return { path: `${cwd}/${id}.jsonl`, id, cwd, projectRoot: project, projectKey: project, created: iso(modified), modified: iso(modified), messageCount: 1, firstMessage: id, ...rest };
}

function uiState({ sessions = {}, projects = {}, ...rest } = {}) {
  return { version: 1, revision: 0, sessions, projects, ...rest };
}

function input(overrides = {}) {
  return { sessions: [], uiState: uiState(), runningIds: new Set(), unreadIds: new Set(), selectedSessionId: null, currentProject: null, groupExpansion: {}, moreShown: {}, pinnedCollapsed: false, ...overrides };
}

const noChats = { cwds: [], collapsed: false, draft: false, label: "General" };
const keysOf = (rows) => rows.filter((row) => row.kind !== "spacer").map((row) => row.key);

test("without the sections the tree is pi-web's: its footer row, no header of ours, its own heights", () => {
  const sessions = [session("a1")];
  const plain = buildSessionTree(input({ sessions }));
  assert.deepEqual(keysOf(plain.rows), ["group:/work/alpha", "footer-open"]);
  assert.deepEqual(plain.rows[0], { kind: "spacer", key: "top-spacer" });
  const sectioned = buildSessionTree(input({ sessions, chats: noChats }));
  assert.deepEqual(keysOf(sectioned.rows), ["chats-header", "projects-header", "group:/work/alpha"]);
  // The heights pi-web's tests list stay pi-web's; ours are kept apart.
  for (const layout of ["desktop", "mobile"]) {
    for (const kind of Object.keys(SECTION_ROW_HEIGHTS[layout])) assert.equal(kind in SIDEBAR_ROW_HEIGHTS[layout], false, kind);
    assert.equal(SIDEBAR_ROW_HEIGHTS[layout]["footer-open"], layout === "desktop" ? 28 : 44);
  }
});

test("registered chat cwds have standalone rows, never project groups or bulk project actions", () => {
  const path = "/scratch/one";
  const chats = { cwds: [path, "/scratch/two"], collapsed: false, draft: true, label: "Chats" };
  const state = input({ chats, currentProject: { key: path, root: path }, selectedSessionId: "chat",
    sessions: [session("chat", { project: "/Pi", cwd: path }), session("pin", { project: path }),
      session("old", { project: "/scratch/two" }), session("pi", { project: "/Pi" }), session("child", { project: `${path}/child` })],
    uiState: uiState({ sessions: { pin: { pinnedAt: BASE }, old: { archivedAt: BASE } }, projects: { [path]: { root: path, pinnedAt: BASE } } }),
  });
  const model = buildSessionTree(state);
  const keys = model.rows.map((row) => row.key);
  assert.deepEqual(keys.filter((key) => ["chats-header", "chat-draft", "session:chat:chat", "projects-header", "pinned-header", "group:/Pi"].includes(key)),
    ["chats-header", "chat-draft", "session:chat:chat", "projects-header", "pinned-header", "group:/Pi"]);
  assert.deepEqual(model.rows.find((row) => row.kind === "projects-header"), { kind: "projects-header", key: "projects-header", collapsed: false });
  assert.equal(keys.includes("footer-open"), false, "Projects + stands for pi-web's footer row");

  const foldedProjects = buildSessionTree({ ...state, projectsCollapsed: true });
  assert.deepEqual(keysOf(foldedProjects.rows), ["chats-header", "chat-draft", "session:chat:chat", "projects-header", "footer-archived"]);
  assert.equal(foldedProjects.rows.find((row) => row.kind === "projects-header").collapsed, true);
  assert.equal(foldedProjects.rows.at(-1).count, 1);

  assert.ok(model.rows.find((row) => row.key === "session:chat:chat").status.selected);
  assert.equal(model.rows.find((row) => row.key === "session:pinned:pin").project.name, "Chats");
  assert.deepEqual(model.projects.map((project) => project.key).sort(), ["/Pi", `${path}/child`]);
  assert.ok(!model.projectKeysToRecord.includes(path));
  assert.deepEqual(familiesToDelete(state, "/Pi").ids, ["pi"]);
  const archived = buildArchiveRows(state);
  assert.equal(archived[0].project.name, "Chats");
  assert.deepEqual(archivedFamilyIds(state, { projectKey: archived[0].project.key }), ["old"]);

  const folded = { ...state, chats: { ...chats, collapsed: true } };
  assert.ok(!buildSessionTree(folded).rows.some((row) => row.key === "session:chat:chat"));
  assert.equal(locateSessionRow(folded, "chat").unfoldChats, true);
  assert.equal(locateSessionRow(state, "pi").unfoldChats, undefined, "a project's session is no chat");
});

test("a project created with Projects + is listed before it has a session, and is not offered a pin to keep it", () => {
  const created = { "/work/new": "/work/new" };
  const model = buildSessionTree(input({ chats: noChats, uiState: uiState({ createdProjects: created }) }));
  assert.deepEqual(keysOf(model.rows), ["chats-header", "projects-header", "group:/work/new"]);
  assert.equal(model.projects[0].registered, true);
  assert.ok(model.projectKeysToRecord.includes("/work/new"));
  // A folder that became a chat's is no project, whoever recorded it.
  const asChat = buildSessionTree(input({ chats: { ...noChats, cwds: ["/work/new"] }, uiState: uiState({ createdProjects: created }) }));
  assert.deepEqual(keysOf(asChat.rows), ["chats-header", "projects-header"]);
});

test("the section rows have heights and gaps of their own, and a group's block starts below the Projects header", () => {
  const sessions = [session("a1"), session("b1", { project: "/work/beta", modified: BASE - 1000 })];
  const empty = buildSessionTree(input({ sessions, chats: noChats }));
  assert.deepEqual(empty.rows.slice(0, 4).map((row) => [row.key, row.height]), [["top-spacer", 2], ["chats-header", undefined], ["chats-spacer", 2], ["projects-header", undefined]]);
  // 2 + 30 + 2 + 30 to the first group, 28px rows and 8px gaps after it, as in pi-web.
  const offsets = getRowOffsets(empty.rows, "desktop");
  assert.deepEqual(offsets.slice(0, 5), [0, 2, 32, 34, 64]);
  assert.deepEqual(getRowOffsets(empty.rows, "mobile").slice(0, 5), [0, 2, 46, 48, 92]);
  assert.deepEqual(groupBlocks(empty.rows, offsets), [
    { key: "/work/alpha", pinned: false, top: 64, bottom: 92, gapAbove: 0, gapBelow: 8 },
    { key: "/work/beta", pinned: false, top: 100, bottom: 128, gapAbove: 8, gapBelow: 8 },
  ]);
  assert.deepEqual(groupDropAt(groupBlocks(empty.rows, offsets), "/work/alpha", 1000), { anchorKey: "/work/beta", position: "after", lineY: 132 });

  // A General section with rows keeps 6px before Projects; a draft is a row of a session's height.
  const cwd = "/chats/one";
  const withChat = buildSessionTree(input({ sessions: [...sessions, session("c1", { project: cwd })], chats: { ...noChats, cwds: [cwd], draft: true } }));
  assert.deepEqual(withChat.rows.slice(0, 6).map((row) => row.key), ["top-spacer", "chats-header", "chat-draft", "session:chat:c1", "chats-spacer", "projects-header"]);
  assert.deepEqual(getRowOffsets(withChat.rows, "desktop").slice(0, 7), [0, 2, 32, 60, 88, 94, 124]);

  for (const layout of ["desktop", "mobile"]) {
    assert.equal(sectionRowHeight({ kind: "group", key: "group:/x" }, layout), undefined);
    assert.equal(sectionRowHeight({ kind: "spacer", key: "pinned-spacer" }, layout), undefined);
    assert.equal(sectionRowHeight({ kind: "spacer", key: "chats-spacer", height: 6 }, layout), 6);
    assert.equal(sectionRowHeight({ kind: "chats-more", key: "chats-more" }, layout), layout === "desktop" ? 26 : 36);
  }
});

test("more than six chats fold into show more, by the General section's own key", () => {
  const cwds = Array.from({ length: 9 }, (_, index) => `/chats/${index}`);
  const sessions = cwds.map((cwd, index) => session(`c${index}`, { project: cwd, modified: BASE - index * 1000 }));
  const model = buildSessionTree(input({ sessions, chats: { ...noChats, cwds } }));
  assert.deepEqual(keysOf(model.rows).slice(0, 9), ["chats-header", "session:chat:c0", "session:chat:c1", "session:chat:c2", "session:chat:c3", "session:chat:c4", "session:chat:c5", "chats-more", "projects-header"]);
  assert.equal(model.rows.find((row) => row.kind === "chats-more").hidden, 3);
  assert.deepEqual(model.projects, [], "a chat's folder is never a project group");
  const more = buildSessionTree(input({ sessions, chats: { ...noChats, cwds }, moreShown: { chats: 20 } }));
  assert.equal(more.rows.filter((row) => row.kind === "session").length, 9);
});

test("a section header stands for rows, so the tree's empty note stays away", () => {
  assert.equal(isSectionContent({ kind: "chats-header", key: "chats-header", collapsed: false }), true);
  assert.equal(isSectionContent({ kind: "projects-header", key: "projects-header", collapsed: true }), true);
  assert.equal(isSectionContent({ kind: "projects-header", key: "projects-header", collapsed: false }), false);
  assert.equal(isSectionContent({ kind: "footer-archived", key: "footer-archived", count: 1 }), false);
});
