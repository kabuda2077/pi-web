# Pi Web Desktop

The desktop app built from this repository: pi-web, its Node.js runtime and a
window, as one installed program for Windows. Nothing else has to be installed,
and a pi-web or Node.js already on the machine is neither used nor disturbed.

It is a fork of [agegr/pi-web](https://github.com/agegr/pi-web) that tracks
upstream release by release. The shell lives in this folder. What the app changes
in pi-web itself is listed under [Changes to pi-web](#changes-to-pi-web).

## What is in the installed app

| Part | Where | What it is |
| --- | --- | --- |
| Shell | `Pi Web Desktop.exe`, `resources/app.asar` | Electron: the window, the tray icon, starting and stopping the server (`src/`) |
| Server | `resources/server` | this repository's pi-web as its npm package holds it (`npm pack`), with the production dependencies from pi-web's lockfile |
| Runtime | `resources/node` | Node.js 22 LTS with npm, which runs the server |

The shell starts the server the way pi-web starts itself: `node bin/pi-web.js --port … --no-open`.
The window then shows `http://127.0.0.1:30171`.

## What the app adds to pi-web in a browser

The shell:

- One program: the server starts with the app and ends with it, also when the app is killed.
- Closing the window keeps the app in the tray, so running tasks go on. Quit from the tray menu.
- A window closed while nothing runs gives its page back after two minutes, and with it the session and MCP servers that page kept alive. Opening the window loads the page where it was. A window closed while a task runs or a terminal is open keeps its page.
- No six-connection limit: many open chats and terminals no longer make other requests wait (pi-web `docs/http2.md`).
- "Task finished" notifications come from the page itself, as Windows notifications; clicking one brings the window forward.
- Links that leave the app open in the system browser. Only `http`, `https` and `mailto` links do.
- The main window has no title bar: minimize, maximize/restore and close are buttons at the right end of pi-web's 36 px toolbar, beside the file-panel toggle. Drag the toolbar's background to move the window; its buttons and file tabs stay clickable. Close sends the window to the tray, as Alt+F4 does.
- The window's size and place, the last page and the theme's background colour are remembered.

The pages (each is a row under [Changes to pi-web](#changes-to-pi-web)):

- The file panel has a button left of Download that shows the file in Explorer. Right-click on a file link in the chat: Open (in the file panel), Show in Explorer, Copy path.
- A turn navigator in the chat's left margin takes the place of pi-web's rail on the right: one tick a turn, a card with the turn's prompt and reply on hover, click or drag to go there.
- The sidebar has three entries of one kind: Tasks, General and Projects.
  - **Tasks** is a page of every session that waits for an answer, runs, or changed lately, across projects.
  - **General** holds chats that belong to no project. Each gets a folder of its own and is an ordinary pi session there, with the tools and permissions of one in a project.
  - **Projects** holds pi-web's project groups. **Sort by date** switches those sessions to date sections and keeps General in its own section. **Projects +** opens pi-web's directory picker. Browse to an existing folder or use **New directory**, then click **Select this folder** to add and show the project and open a new conversation there. The project stays in the sidebar even if you leave before sending a message.
- Settings › Models: adding the models a provider lists fills in what models.dev knows about each, and a provider can have a default context window for the models added to it.
- Settings › General is laid out in two columns in a wide window, and keeps its rows in place while the tool settings load.

## Data

| What | Where |
| --- | --- |
| Sessions, models, settings | `~/.pi/agent`, shared with the pi CLI and any other pi-web |
| A provider's default for imported models (Settings › Models) | `~/.pi/agent/pi-web-model-import.json` |
| The General chats' folders | `~/Chats/chat-<id>`, one a chat; another place can be chosen in Settings › General, for the chats started from then on |
| Which folders are General chats | `~/.pi/agent/pi-web-temp-chats.json` |
| The projects added with Projects + | `createdProjects` in pi-web's own `~/.pi/agent/pi-web-session-state.json` |
| Window state, page storage (theme, drafts), logs | `%APPDATA%\pi-web-desktop` |

Uninstalling removes none of it. With `PI_CODING_AGENT_DIR` set, the General chats' folders are
in `pi-web-chats` under that directory, so a test run never touches `~/Chats`.

## Working on it

```bash
npm ci            # in the repository root: pi-web's dependencies
npm run build     # in the repository root: the pi-web build the shell serves
cd desktop
npm ci
npm start         # run the shell from source
npm test          # the shell's unit tests
```

A run from source uses the `node` on PATH and its own profile (`%APPDATA%\pi-web-desktop-dev`),
so it can run beside the installed app. Both use port 30171 when it is free.

## Building and checking

```bash
cd desktop
npm run dist            # builds pi-web, stages the payload, writes release/PiWebDesktop-Setup-<version>.exe
npm run pack            # the same without the installer: the unpacked app only
npm run verify          # the changes' unit tests, then the unpacked app's self-test (after either of the two above)
npm run test:pages      # the changes' browser checks, on previews it starts itself
npm run test:upstream   # pi-web's own tests, against the failures this machine is known to have
```

None of them reads or writes `~/.pi/agent` or `~/Chats`, and none sends a message to a model.

**`npm run verify`** first runs `npm run test:changes`: the unit tests of the changes to pi-web,
this fork's files named `*.desktop.test.mjs`. It then starts the built app with `--self-test`,
off screen and on a throwaway profile and agent directory, three times:

- *works*: the page loads, an agent session starts, a terminal runs a shell, more than six
  streams open, closing and reopening the window works, the server restarts on the same
  address. Then each change to the pages, in the built app:
  - the file link's menu and the file panel's button reach the shell with the file's full path
  - the turn navigator
  - the caption buttons
  - the import defaults' file beside models.json
  - the sidebar's three entries and the tasks page
  - a General chat's composer in the folder reserved for it: pi-web's model list must serve
    that folder, or the composer shows "Access denied"
  - Projects + opening the directory picker, and a selected folder staying listed
  - General settings in two columns, with the tool switches loaded
- *server-fails*: a server that cannot start is reported, with Retry.
- *app is killed*: killing the app leaves no server behind, and the next launch clears the run
  record the killed server left.

It sends no message to a model, and it does not cover what only shows on a real screen: the
tray icon and the notifications.

The turn navigator check uses a temporary 32-turn transcript. It checks that hovering
previews one turn without scrolling, and checks both the native scroll mode and the
actual destination on tick and card clicks (smooth unless reduced motion is requested). During a drag
it measures the target prompt inside the pointer event, before release. Mouse focus has
no full-rail ring; keyboard focus highlights the selected tick. The card must identify
the same prompt as 27/32 both before and after loading the older page. Arrow keys,
narrow layouts and the single-turn file-link fixture are also checked.

The caption check uses the temporary file-link session with the right panel closed and open.
Exactly one `[data-window-controls]` group should be visible. Its buttons have
`data-window-action="minimize"`, `"toggle-maximize"` and `"close"`, in that order; the
middle button reflects the window state with `data-maximized="false"` or `"true"`.
The test checks 42px buttons with edge-to-edge square hover fills (red with a white X on Close), their spacing against the panel toggle and the right
edge, the row height, and the computed `drag` / `no-drag` regions at the current DPI.
It also checks the rendered bottom divider all the way to the last pixel, in the same
picture that shows the panel toggle selected. Open `caption-buttons.png` beside
`report.json` in the temporary directory printed by verification: it is a real capture
of the top-right 440 × 44 CSS pixels with the panel open.

Clicks go through the real page, preload and main-process IPC handler. Only the native
minimize, maximize and restore operations and the maximized-state query on the hidden
test window are replaced: these checks verify dispatch and the button's state changes,
not OS animations, window placement or dragging. Close is not replaced: the test checks
that the real window receives a close event, hides to the tray and is not destroyed.

**`npm run test:pages`** runs the changes' browser checks, each against a preview of the real
components over a mock API (`e2e/preview-*.mjs`): the flows a self-test cannot drive without a
model. A preview already serving its port is used as it is.

- `e2e/model-import.mjs` (port 30243): a model import, with a catalog lookup that fails and one that answers late
- `e2e/task-home.mjs` (port 30245): the tasks page, a General chat from its + to its first send, adding new and existing folders with Projects +, and archive navigation and focus
- `e2e/general-settings.mjs` (the same preview): Settings › General at five widths, with a slow and a failing tool-settings request

**`npm run test:upstream`** runs pi-web's own tests and reports only the failures that are not
in `upstream-tests.baseline.json`: the tests that fail on this Windows machine whatever this
fork changes, each with why.
It runs them with a home and a temporary directory of their own, outside the user's profile
(`scripts/upstream-test-env.mjs`): pi reads a `.agents/skills` folder above a project as a reason
to ask for trust, and a profile that has one fails some sixty tests that have nothing to do with it.
A failure outside the baseline is run once more on its own, since some tests depend on timing.
After a look at what changed, `npm run test:upstream -- --update` rewrites the baseline from the
run; entries it adds have an empty `why` to fill in.
This fork's `*.desktop.test.mjs` are among the tests it runs: pi-web's test command finds them
by its own patterns.

Intermediate files go to `desktop/node_modules/.cache/build`.

Running the installer over a running app closes it first; that is how an update is installed.

## Changes to pi-web

Every change the app makes to pi-web. The aim is that a new pi-web release merges with as
little work as it can: what conflicts in a rebase is a line of pi-web's that this fork edited,
and nothing else.

How a change is made, so that it stays that way:

- **Its code is in files of its own.** A file of pi-web's gets the lines that call it, no more.
- **Its text is in `lib/i18n/desktop-messages.ts`**, which `lib/i18n/registry.ts` merges over
  pi-web's messages. `lib/i18n/messages/*.ts` change with almost every upstream commit and stay
  untouched.
- **Its styles are in `app/desktop.css`**, loaded after pi-web's stylesheets (`app/layout.tsx`),
  so a rule there wins over pi-web's at equal weight; over a style pi-web sets inline it needs
  `!important`. `app/globals.css`, `settings.css` and `sidebar.css` stay untouched.
  A component of this fork's that pi-web's tests render (the sidebar and what it opens) uses
  plain classes there, not a CSS module: those tests load none.
- **pi-web's tests and `docs/` stay untouched.** What this fork adds has tests of its own, in
  files named `*.desktop.test.mjs`, and what there is to say about it is said here.
  Without what this fork hands it, a component is pi-web's: `buildSessionTree()` has the
  sections only when given `chats`, and outside `DesktopSidebarContext` the sidebar has no
  Tasks entry and pi-web's New button. That is what pi-web's tests render, so they pass as written.
- **What a component of pi-web's needs from the shell goes down in a context**
  (`hooks/useDesktopSidebar.ts`), not in new props: its props and its signature are lines
  pi-web edits too.
- **No code goes between two functions pi-web's tests cut out by name.** They read
  `AppShell.tsx` and `SessionSidebar.tsx` as text, from `const handleNewSession` to the next
  `const hydrateSelectedSession`, and run the piece: a function put in between is run with it.
- **A block of pi-web's that is wrapped keeps its indentation** (Settings › General's two
  columns), so a merge shows the lines that changed and not the whole block.
- **One commit a change**, with its rows of the table below and its checks.
  The sidebar's Tasks, General and Projects are one change: they share their look, the
  sidebar's state and their checks.

`npm run verify` and `npm run test:pages` check the desktop changes. Upstream can move the
code a change depends on without Git noticing.

| Change | Own files | Lines in pi-web's files | Breaks without a conflict when upstream |
| --- | --- | --- | --- |
| "Show in Explorer" button in the file panel | `components/DesktopFileActions.tsx`, `lib/desktop-host.ts`, `desktop/src/files.mjs`, `desktop/src/file-actions.mjs` | `components/FileViewer.tsx`: one import, and `DownloadLink()` renders the button before its link | gives a file panel a Download that is not `DownloadLink()` |
| Menu of a file link in the chat | the same | `components/MarkdownBody.tsx`: one import, and `onContextMenu` on the `<a>` of a local file link | renders file links somewhere else than the `a()` renderer of `MarkdownBody` |
| Unread markers: no cleanup is dispatched when no marker is read, and a running change that alters none keeps the Map it had | | `components/SessionSidebar.tsx`: three lines | (a fix of pi-web's; gone once upstream has it) |
| Left turn navigator: smooth click, instant drag, keyboard focus on one tick, current/total on the card; hidden for one turn or a left gutter under 64 px | `components/TurnNavigator.tsx`, `components/TurnNavigator.module.css` | `components/ChatWindow.tsx`: renders it where `ChatMinimap` was (its `useMessageRefs` is still used), and `CHAT_MINIMAP_WIDTH` is 0 | changes transcript scrolling, turn grouping or page counts, the placement of the message column, or the inline padding of the composer and the new-session header (52 px at the right, which `app/desktop.css` sets back to 16) |
| Caption buttons in the main window | `components/DesktopWindowControls.tsx`, `lib/desktop-host.ts`, `desktop/src/window.mjs`, `preload.cjs`, `main.mjs`, `ui/loading.html` | `components/AppShell.tsx`: `data-desktop-bar` and `data-caption-edge` on the chat's and the file panel's top bars, a class on the toolbar's actions (with the trust warning moved into them), and `<DesktopWindowControls />` | adds a bar that reaches the window's top right corner, or moves the toolbar's buttons out of those two bars |
| Model import: adding discovered models fills in their catalog details; a default context window for a provider's imported models, with Apply to all | `lib/model-import.ts`, `lib/model-import-defaults.ts`, `app/api/models-config/import-defaults/route.ts` | `components/ModelsConfig.tsx`: the field, `addDiscoveredModels()` and the import status, and the draft's defaults merged in on load and split off on save; `app/api/models-config/catalog/route.ts`: `POST`, a batch lookup | changes discovery fields, `fillEmptyModelFields()` or exact catalog matching, or loads and saves the editor's draft somewhere else |
| Tasks page | `components/TasksPage.tsx`, `components/TasksPage.module.css`, `lib/task-groups.ts` | `components/AppShell.tsx`: the page over the chat, which stays mounted; `components/SessionSidebar.tsx`: the entry and its count, the two status sets reported to the shell, and no row selected while the page shows; `hooks/useKeyboardShortcuts.ts`: `suspendGlobalAbort()`, so Esc stops no run from the page; `components/SidebarIcons.tsx`: one icon | stops polling `awaitingInputSessionIds` or `subagentsActiveSessionIds`, or keeps the global Esc somewhere else |
| General chats, in a General section above Projects | `lib/temp-chats.ts`, `lib/temp-chat-path.ts`, `app/api/temp-chats/route.ts`, `hooks/useTempChatDirectories.ts`, `components/TempChatSettings.tsx`, `lib/sidebar-sections.ts`, `components/SidebarSectionRows.tsx` | `components/AppShell.tsx`: `showTempChat()` and `openTempChat()`, and the chat's folder as its composer's `newSessionCwd`; `lib/session-tree.ts`: the sections' rows when given `chats`, and a chat's folder kept out of the project groups; `components/SessionTree.tsx`: the rows' renderer; `components/SessionSidebar.tsx`: the sections' folds and the header button's target; `components/SettingsPanel.tsx`: the folder's row | starts a new session from something else than `newSessionCwd`, gives a folder access some other way than `allowFileRoot()`, or changes how `buildSessionTree()` orders its rows or `getRowOffsets()` sizes them |
| Projects +: select or create a folder in pi-web's directory picker, then add it to the sidebar and open a new conversation there | `components/SidebarSectionRows.tsx`: the + | `components/SessionSidebar.tsx`: reuses `DirectoryPicker` and `/api/cwd/validate`, then registers the selected folder; `lib/session-tree.ts`: `createdProjects` among the groups; `lib/session-ui-state*.ts`, `app/api/sessions/ui-state/route.ts`: `register-project` | changes when the picker confirms a selection, what directory validation returns, or how projects without sessions are stored and listed |
| Settings › General in two columns from 900 px; Appearance, Fonts and Language left, Chat, Workspace and Tools right; the tool rows hold their place while they load | a section of `app/desktop.css` | `components/SettingsPanel.tsx`: two wrappers around the sections, Language moved up, three sections under one heading, placeholders for the tool rows; `lib/theme.ts`: System last in the themes' order | adds a section to General (it lands in the right column), or sizes the themes' grid differently |
| Archive in the sidebar: a separate entry with a divider and a right-aligned count, and a view with its own heading and controls | `components/SidebarArchive.tsx`; `lib/sidebar-sections.ts` reserves the space above the entry button that `app/desktop.css` uses for padding | `components/SessionTree.tsx`: the entry and the group count; `components/SessionSidebar.tsx`: Tasks stays with the main view, and the archive gets a separate back button and title | moves the footer, changes how `getRowOffsets()` sizes the entry, or changes how the main view and archive share space and restore focus |

The three main sidebar rows also share `hooks/useDesktopSidebar.ts` and a section of
`app/desktop.css`.

For file actions and the caption the page reaches the shell through `window.piDesktopHost`
(`src/preload.cjs`), which a browser does not have: there the buttons are absent and the
browser's own menu stays.
The shell acts only on a path with a drive letter. A UNC path (`\\host\share\…`) is refused,
since chat text comes from a model and looking at such a path signs Windows in to the server
it names.

### Unread markers

The sidebar's unread cleanup and its running transitions share one React state queue. While the
page hydrates, a cleanup of lower priority can be skipped, and React then replays the running
update after it. pi-web returns a fresh Map from that update even when nothing changed, and
dispatches the cleanup even when no marker is read: each replay starts another cleanup, and the
page stops with "Maximum update depth exceeded". It happens on some starts, by timing.
`components/unread-markers.desktop.test.mjs` holds both halves of the fix in place.

### Model import

Add selected stages the discovered rows, then looks up exact models.dev recommendations in
batches through `POST /api/models-config/catalog`. Import and the row's own "fill in" use the
same empty-field merge; a failed lookup never removes a discovered model. A provider's default
context window is an editor preference, not a setting of pi's: it is kept in
`pi-web-model-import.json` beside models.json, which pi's schema owns. The editor carries it in
its draft on the provider (`piWebImportContextWindow`), so a rename takes it along; on Save it
writes models.json without it, then the defaults. Import copies it to each new row's
`contextWindow`. Changing or clearing it rewrites no existing row; Apply to all sets that
provider's rows in the draft, and the ordinary Save persists them.

### General chats

A General chat is an ordinary pi session whose folder the app chose. Its composer is pi-web's
fresh composer with that folder as `newSessionCwd`, so everything pi-web does for a new session
in a folder (models, tools, attachments, the first send) is pi-web's own code, unchanged.

- The folder is reserved ahead (`POST /api/temp-chats`, `hooks/useTempChatDirectories.ts`): a
  page holds one for the chat it starts next, from when it loads and again once a chat has taken
  it. So the composer opens with the click. One that waited for the reservation would leave the
  chat before it on screen for a moment, taking what is typed.
- A reservation takes a folder that is still empty and that no session has, before it makes a
  new one. So a chat opened and left unsent keeps its folder for the next chat, and one empty
  folder waits under `~/Chats`, from the first start on. A folder with a file in it is never
  handed out again.
- A folder is held under its holder's name, in the server's memory, and two holders never share
  one. The app's main window is one holder whatever page it shows, and a browser tab is one
  across its reloads, so asking again answers the same folder: the shell ends a hidden page
  without the page hearing of it, and no folder is made for the page that follows. A tab that
  closes gives its folder back (`DELETE`); a restart of the server frees every folder no chat
  used.
- Reserving grants file access to that one folder (`allowFileRoot()`), as picking a project
  does. The folder above it and the chats beside it stay closed.
- A registry written before the default moved from `~/Pi Chats` to `~/Chats` names the old
  default as its root. It is read as the new default; its chats keep their folders. Whoever
  chose `~/Pi Chats` on purpose picks it once more in Settings › General.

## Following upstream

Choose the upstream release tag when you are ready to follow it. This PowerShell example
starts from a desktop branch based on `v0.18.0` and follows `v0.19.0` in a separate checkout.

```powershell
$old = "v0.18.0"
$new = "v0.19.0"
git fetch upstream tag $new
$paths = @(git diff --name-only $old desktop -- . ':!desktop')
git diff --stat $old $new -- @paths
git worktree add -b "follow/$new" "../pi-web-follow-$new" desktop
Set-Location "../pi-web-follow-$new"
git rebase --onto $new $old
```

The diff shows which upstream files the two branches both changed. The rebase starts at
the entire new release and replays the desktop commits after the old release. Resolve
each conflict, stage the files and run `git rebase --continue`. Review the table above for
behavior changes even in files Git merged automatically. Check that the new tag is an
ancestor with `git merge-base --is-ancestor $new HEAD` and compare the desktop commits
before and after with `git range-diff "$old..desktop" "$new..HEAD"`.

In the follow worktree, run the following stages in order. Update the Windows test
baseline only after reproducing any new failure on the unmodified upstream tag in the
same environment. Keep the pre-rebase `desktop` tip available until the follow branch
is tested and ready to take its place.

```powershell
npm ci
Set-Location desktop
npm ci
npm run dist
npm run verify
npm run test:pages
npm run test:upstream
```

The shell reads nothing version-specific from pi-web beyond what its own launcher and
HTTP API offer, so a new release needs no change here unless one of these changes upstream:

- `bin/pi-web.js`: the options `--port`, `--hostname`, `--no-open`, and `status` dropping the records of servers that are gone; `bin/run-records.js`
- `GET /api/agent/running` and `GET /api/agent/debug` (`server.terminals.count`), read to decide whether a hidden page may be released
- the page calling `window.focus()` when its notification is clicked, and using its service worker only behind `"serviceWorker" in navigator` (`src/preload.cjs`)

`npm run verify` exercises the launcher and API contracts, and starts the app with its service
worker disabled. Checking whether notification clicks still call `window.focus()` takes a
manual run.
