# Pararec

Pararec is a recursive two-column notebook.

## Local use

Run it on your own computer. Public hosting and shared remote access are outside its supported scope. The server uses loopback access and does not provide user authentication.

## Setup

Use Zig 0.16.0, Node.js 26, and pnpm 10.17.1.

Install dependencies and build the application.

```sh
pnpm install
pnpm build
```

## Run

Open one document from the repository root.

```sh
./local/zig-out/bin/pararec open document.json
```

Choose another port or static directory when needed.

```sh
./local/zig-out/bin/pararec open fixtures/flat.json --port 4546 --static ./dist
```

## Configuration

This example shows an empty document with the default layout settings.

```json
{
  "version": 1,
  "title": "My notes",
  "config": {
    "showTitles": true,
    "maxWidth": 1100,
    "outerWidthRate": { "left": 35, "right": 65 },
    "innerWidthRate": { "left": 35, "right": 65 }
  },
  "root": []
}
```

| Field | Default | Effect |
| --- | --- | --- |
| `title` | File name without its extension | Document title. |
| `config.showTitles` | `true` | Show the document title. Set to `false` to hide it and remove its space. |
| `config.maxWidth` | `1100` | Maximum width of the notes area in pixels. |
| `config.outerWidthRate` | `{ "left": 35, "right": 65 }` | Relative column widths for rows in the current layer. |
| `config.innerWidthRate` | `{ "left": 35, "right": 65 }` | Relative column widths for child rows shown inside a right cell. |

Documents support up to 64 nested container levels. Deeper documents are rejected by the client and server.

Omitted fields use their defaults. Width values must be positive, finite numbers. Column rates are proportions and do not need to total 100. For example, `{ "left": 1, "right": 2 }` makes the right column twice as wide as the left. Use the exact key `innerWidthRate` as shown.

## Develop

Start Vite, the CSS watcher, and the local server together.

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite forwards `/api` requests to the local server on port 4545. The server lives in `local/`. The client build is written to `dist/`.

## Test

Run the type checks, client unit tests, Zig tests, and HTTP integration tests.

```sh
pnpm check
pnpm lint
pnpm test:unit
pnpm test:local
pnpm test:api
```

Install Chromium and WebKit before running browser tests.

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

CI installs browser system dependencies and runs all these checks. Browser downloads require access to Playwright's download hosts.

Test the built client and release server together with a disposable document.

```sh
pnpm test:release
```

CI is configured to run the checks and both browser suites on Linux, macOS, and Windows. Native IME validation still requires the manual checks below.

## Editing and saving

While editing a note, use the following shortcuts. On macOS, use Cmd in place of Ctrl.

| Shortcut | Action |
| --- | --- |
| Arrow keys | Move the cursor within text. At a note boundary, move to the next cell in that direction. |
| Shift+Left / Shift+Right | Move between cells and columns from any cursor position. |
| Shift+Up / Shift+Down | Move to the cell above or below from any cursor position. |
| Enter | Insert a line break. |
| Shift+Enter | Create an empty sibling row with left and right cells and focus the same column in the new row. Keep all text in the original cell. At the start of the full-width parent note in a child layer, insert the empty row before its children instead. |
| Shift+Alt+Enter | Insert an empty two-column row above the current record and focus the same column. Keep all existing text in place. |
| Alt+Enter in a left cell | Split at the cursor into a new left cell in the same row. |
| Ctrl+Enter in a right cell | Add an empty child row and focus its right cell. |
| Shift+Delete | Remove the current row, including its children. |
| Alt+Delete in a left cell | Remove the current left cell, unless it is the last one in the row. |
| Ctrl+Delete in a right cell | Remove all child rows of the current note. |
| Alt+Up / Alt+Down | Move the current left cell or row up or down. |
| Ctrl+A | Select all text in the current note. |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, or paste text. |
| Ctrl+S | Save immediately. |
| Ctrl+Z | Undo text, structure, or link changes. |
| Ctrl+Shift+Z / Ctrl+Y | Redo an action. |

If the file changes outside the app, saving stops and offers Reload or Overwrite. Reload replaces your notes with the disk version and clears history. Overwrite saves your local notes against the current disk version.

The app warns before leaving with unsaved changes. Keep the page open until a disk save succeeds. Unsaved changes are held only in memory and are lost when the page closes or reloads.

Save requests time out after 15 seconds and offer Retry save. A timed-out request may have reached disk. A retry uses the original ETag and can report a conflict, so review the disk version before overwriting it.

A load error offers Retry. Start the local server if it is unreachable, check file permissions if it cannot read the file, or fix invalid JSON and schema errors before retrying.

## Linking text to cells

Link a text selection to one or more destination cells.

1. Select text in a note by dragging across it, or press Ctrl+A to select the whole note.
2. Right-click the selection and choose Start linking.
3. Click destination cells. Selected cells turn blue. Click a selected cell again to deselect it. The source cell cannot be a destination for its own label.
4. Choose Done to create the link. Select at least one destination to enable Done.

Notes are read-only during linking. Choose Cancel in the linking toolbar or press Escape to leave without creating a link.

Linked text appears inside a rectangle. Small numbers at its bottom right identify destinations in selection order. Click a number to navigate to that cell.

Right-click the label or one of its destination numbers to manage the link.

- Choose Remove label to remove the label and all its destinations while keeping the text.
- Choose Remove 1, Remove 2, and so on to remove an individual destination. Hover over an option to preview its cell text. Removing the last destination also removes the label.
- Click outside the menu or press Escape to dismiss it.

Links are saved with the document. Use Ctrl+Z to undo link creation or removal and Ctrl+Shift+Z or Ctrl+Y to redo it. On macOS, use Cmd in place of Ctrl.

Reed attention anchors track linked text as surrounding text changes. Typing inside a label expands it. Typing at its end stays outside, including after deleting the label's last character. Labels remain visible during Japanese IME composition.

## Performance and native input

Run the browser performance scenarios separately when collecting measurements.

```sh
pnpm test:performance
```

Each scenario attaches a JSON report with host and browser details. The 5,000-line note records 100 input-to-DOM samples after five warmups, including tree and history updates. It excludes physical input, native IME, and painting. The 1,000-row level records navigation-to-ready time and DOM size. The suite fails when p95 input-to-DOM latency reaches 8 ms or navigation-to-ready reaches 10 seconds. Measurements use the production client and server. Run on representative hardware before release.

Follow [the native IME checks](docs/ime-checks.md) on macOS and Windows. Run `pnpm test:readiness` for the release checks. This command runs the editor browser suite as well as the built release and performance suites. It also requires native IME results recorded for the current code.

Install the required browsers before running the release checks.

```sh
pnpm exec playwright install --with-deps chromium webkit
pnpm test:readiness
```

CI runs automated checks on every push and pull request. Tag pushes and manual workflow runs also require the `release-readiness` job after all three operating systems pass. That job checks native IME evidence with full Git history. Release only a commit whose automated checks and `release-readiness` job both pass. Manual input results remain pending until a tester records them in `docs/ime-checks.md`.

## Server limits

The server is intended for local use and listens only on `127.0.0.1`. It accepts at most 16 connections and closes each connection after 30 seconds, including incomplete requests. Excess connections are closed immediately. Document requests wait for one shared permit before reading or parsing data.

Uploads are limited to 32 MiB. Files read from disk and formatted saves are limited to 128 MiB. Requests above the upload limit return HTTP 413. Keep individual documents below the upload limit to allow continued editing and saving. Split larger notebooks into separate files.

## Document API

Read the document and its quoted ETag.

```sh
curl -i http://127.0.0.1:4545/api/document
```

Create a missing document using an explicit creation precondition.

```sh
curl -i -X PUT http://127.0.0.1:4545/api/document \
  -H 'Origin: http://127.0.0.1:4545' \
  -H 'Content-Type: application/json' \
  -H 'If-None-Match: *' \
  --data-binary @fixtures/empty.json
```

To update a document, replace the creation header with `If-Match` containing the ETag from GET. A stale ETag returns `412`. PUT requires the matching Origin header, including for command-line clients.

The server validates the schema, writes formatted JSON through an atomic replacement, and keeps the previous bytes in `<document>.bak`. It holds an operating system lock on `<document>.lock` for its lifetime, so another Pararec process cannot open the same canonical document path, including a symbolic link to that path. The lock releases when the process exits or crashes. Leave the lock file in place, including while the server runs. Its presence alone does not mean the document is locked.

The mutex coordinates requests to the running server. The server also checks the file immediately before replacement and rejects changes detected while preparing the save. Programs that ignore Pararec's lock can still change the file between that final check and replacement. Avoid editing the file from another program during a save. Open documents through one canonical path and avoid hard-link aliases.
