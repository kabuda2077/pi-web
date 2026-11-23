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
- The window's size and place, the last page and the theme's background colour are remembered.

The pages (each is a row under [Changes to pi-web](#changes-to-pi-web)):

- The file panel has a button left of Download that shows the file in Explorer. Right-click on a file link in the chat: Open (in the file panel), Show in Explorer, Copy path.

## Data

| What | Where |
| --- | --- |
| Sessions, models, settings | `~/.pi/agent`, shared with the pi CLI and any other pi-web |
| Window state, page storage (theme, drafts), logs | `%APPDATA%\pi-web-desktop` |

Uninstalling removes none of it.

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
npm run test:upstream   # pi-web's own tests, against the failures this machine is known to have
```

None of them reads or writes `~/.pi/agent`, and none sends a message to a model.

**`npm run verify`** first runs `npm run test:changes`: the unit tests of the changes to pi-web,
this fork's files named `*.desktop.test.mjs`. It then starts the built app with `--self-test`,
off screen and on a throwaway profile and agent directory, three times:

- *works*: the page loads, an agent session starts, a terminal runs a shell, more than six
  streams open, closing and reopening the window works, the server restarts on the same
  address. Then each change to the pages, in the built app:
  - the file link's menu and the file panel's button reach the shell with the file's full path
- *server-fails*: a server that cannot start is reported, with Retry.
- *app is killed*: killing the app leaves no server behind, and the next launch clears the run
  record the killed server left.

It sends no message to a model, and it does not cover what only shows on a real screen: the
tray icon and the notifications.

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
- **pi-web's tests and `docs/` stay untouched.** What this fork adds has tests of its own, in
  files named `*.desktop.test.mjs`, and what there is to say about it is said here.
- **One commit a change**, with its rows of the table below and its checks.

`npm run verify` has a check for each change, because upstream can also move the code around
such a line without git noticing.

| Change | Own files | Lines in pi-web's files | Breaks without a conflict when upstream |
| --- | --- | --- | --- |
| "Show in Explorer" button in the file panel | `components/DesktopFileActions.tsx`, `lib/desktop-host.ts`, `desktop/src/files.mjs`, `desktop/src/file-actions.mjs` | `components/FileViewer.tsx`: one import, and `DownloadLink()` renders the button before its link | gives a file panel a Download that is not `DownloadLink()` |
| Menu of a file link in the chat | the same | `components/MarkdownBody.tsx`: one import, and `onContextMenu` on the `<a>` of a local file link | renders file links somewhere else than the `a()` renderer of `MarkdownBody` |

For file actions the page reaches the shell through `window.piDesktopHost` (`src/preload.cjs`),
which a browser does not have: there the button is absent and the browser's own menu stays.
The shell acts only on a path with a drive letter. A UNC path (`\\host\share\…`) is refused,
since chat text comes from a model and looking at such a path signs Windows in to the server
it names.

## Following upstream

```bash
git fetch upstream --tags
git diff --stat v<old> v<new> -- $(git diff --name-only v<old> desktop -- . ':!desktop')   # what the release changed in files this fork touches
git rebase --onto v<new> v<old> desktop
cd desktop && npm run dist && npm run verify
npm run test:upstream
```

The second line names the files to look at first: a file it lists was changed on both sides,
and a rebase that reports no conflict there can still have moved the code a change relies on
(the table's last column). The checks above find that.

The shell reads nothing version-specific from pi-web beyond what its own launcher and
HTTP API offer, so a new release needs no change here unless one of these changes upstream:

- `bin/pi-web.js`: the options `--port`, `--hostname`, `--no-open`, and `status` dropping the records of servers that are gone; `bin/run-records.js`
- `GET /api/agent/running` and `GET /api/agent/debug` (`server.terminals.count`), read to decide whether a hidden page may be released
- the page calling `window.focus()` when its notification is clicked, and using its service worker only behind `"serviceWorker" in navigator` (`src/preload.cjs`)

`npm run verify` fails when one of the first two breaks, when the page no longer loads
without its service worker, or when a change listed above no longer works. It cannot tell
whether the page still calls `window.focus()`.
