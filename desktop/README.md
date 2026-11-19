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

## What the shell adds to pi-web in a browser

- One program: the server starts with the app and ends with it, also when the app is killed.
- Closing the window keeps the app in the tray, so running tasks go on. Quit from the tray menu.
- A window closed while nothing runs gives its page back after two minutes, and with it the session and MCP servers that page kept alive. Opening the window loads the page where it was. A window closed while a task runs or a terminal is open keeps its page.
- No six-connection limit: many open chats and terminals no longer make other requests wait (pi-web `docs/http2.md`).
- "Task finished" notifications come from the page itself, as Windows notifications; clicking one brings the window forward.
- Links that leave the app open in the system browser. Only `http`, `https` and `mailto` links do.
- The file panel has a button left of Download that shows the file in Explorer, selected in its folder.
- Right-click on a file link in the chat: Open (in the file panel), Show in Explorer, Copy path.
- The window's size and place, the last page and the theme's background colour are remembered.

## Data

| What | Where |
| --- | --- |
| Sessions, models, settings | `~/.pi/agent`, shared with the pi CLI and any other pi-web |
| Window state, page storage (theme, drafts), logs | `%APPDATA%\pi-web-desktop` |

Uninstalling removes neither.

## Working on it

```bash
npm ci            # in the repository root: pi-web's dependencies
npm run build     # in the repository root: the pi-web build the shell serves
cd desktop
npm ci
npm start         # run the shell from source
npm test          # unit tests
```

A run from source uses the `node` on PATH and its own profile (`%APPDATA%\pi-web-desktop-dev`),
so it can run beside the installed app. Both use port 30171 when it is free.

## Building

```bash
cd desktop
npm run dist      # builds pi-web, stages the payload, writes release/PiWebDesktop-Setup-<version>.exe
npm run pack      # the same without the installer: the unpacked app only
npm run verify    # tests the unpacked app (after either of the two above)
```

`npm run verify` starts the built app with `--self-test`, off screen and on a throwaway
profile and agent directory. It checks that the page loads, an agent session starts, a
terminal runs a shell, more than six streams open, closing and reopening the window works,
the server restarts on the same address, a file link's menu and the file panel's button
reach the shell with the file's full path, a server that cannot start is reported, killing
the app leaves no server behind, and the next launch clears the run record the killed
server left. It sends no message to a model, and it does not cover what only shows on a
real screen: the tray icon and the notifications.

Intermediate files go to `desktop/node_modules/.cache/build`.

Running the installer over a running app closes it first; that is how an update is installed.

## Changes to pi-web

Every change the app makes to pi-web, one commit each. A change keeps its code in files
of its own and touches upstream's files only where it has to be called from; those lines
are what a rebase can conflict on. `npm run verify` has a check for each change, because
upstream can also move the code around such a line without git noticing.

| Change | Own files | Lines in upstream's files | Breaks without a conflict when upstream |
| --- | --- | --- | --- |
| "Show in Explorer" button in the file panel | `components/DesktopFileActions.tsx`, `lib/desktop-host.ts`, `desktop/src/files.mjs`, `desktop/src/file-actions.mjs` | `components/FileViewer.tsx`: one import, and `DownloadLink()` renders the button before its link | gives a file panel a Download that is not `DownloadLink()` |
| Menu of a file link in the chat | the same | `components/MarkdownBody.tsx`: one import, and `onContextMenu` on the `<a>` of a local file link | renders file links somewhere else than the `a()` renderer of `MarkdownBody` |

The page reaches the shell through `window.piDesktopHost` (`src/preload.cjs`), which a
browser does not have: there the button is absent and the browser's own menu stays.
The shell acts only on a path with a drive letter. A UNC path (`\\host\share\…`) is
refused, since chat text comes from a model and looking at such a path signs Windows in
to the server it names.

## Following upstream

```bash
git fetch upstream --tags
git rebase --onto v<new> v<old> desktop
cd desktop && npm run dist && npm run verify
npm run test:upstream
```

`npm run test:upstream` runs pi-web's own tests and reports only the failures that are not
in `upstream-tests.baseline.json`: the tests that fail on this Windows machine whatever
this fork changes, each with why. A failure outside it is run once more on its own, since
some tests depend on timing. After a look at what changed, `npm run test:upstream -- --update`
rewrites the baseline from the run; entries it adds have an empty `why` to fill in.

The shell reads nothing version-specific from pi-web beyond what its own launcher and
HTTP API offer, so a new release needs no change here unless one of these changes upstream:

- `bin/pi-web.js`: the options `--port`, `--hostname`, `--no-open`, and `status` dropping the records of servers that are gone; `bin/run-records.js`
- `GET /api/agent/running` and `GET /api/agent/debug` (`server.terminals.count`), read to decide whether a hidden page may be released
- the page calling `window.focus()` when its notification is clicked, and using its service worker only behind `"serviceWorker" in navigator` (`src/preload.cjs`)

`npm run verify` fails when one of the first two breaks, when the page no longer loads
without its service worker, or when a change listed above no longer works. It cannot tell
whether the page still calls `window.focus()`.
