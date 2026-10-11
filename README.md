# Pararec

Pararec is a recursive two-column notebook.

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
    "innerIdthRate": { "left": 35, "right": 65 }
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
| `config.innerIdthRate` | `{ "left": 35, "right": 65 }` | Relative column widths for child rows shown inside a right cell. |

Documents support up to 64 nested container levels. Deeper documents are rejected by the client and server.

Omitted fields use their defaults. Width values must be positive, finite numbers. Column rates are proportions and do not need to total 100. For example, `{ "left": 1, "right": 2 }` makes the right column twice as wide as the left. Use the exact key `innerIdthRate` as shown.

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
| Shift+Enter | Split at the cursor into a new sibling row with left and right cells. Move the remaining text to the same column in the new row. |
| Alt+Enter in a left cell | Split at the cursor into a new left cell in the same row. |
| Ctrl+Enter in a right cell | Add an empty child row and focus its right cell. |
| Shift+Delete | Remove the current row, including its children. |
| Alt+Delete in a left cell | Remove the current left cell, unless it is the last one in the row. |
| Ctrl+Delete in a right cell | Remove all child rows of the current note. |
| Alt+Up / Alt+Down | Move the current left cell or row up or down. |
| Ctrl+A | Select all text in the current note. |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, or paste text. |
| Ctrl+S | Save immediately. |
| Ctrl+Z | Undo text or structure changes. |
| Ctrl+Shift+Z / Ctrl+Y | Redo an action. |

If the file changes outside the app, saving stops and offers Reload or Overwrite. Reload replaces your notes with the disk version and clears history. Overwrite saves your local notes against the current disk version.

Committed edits are also written to IndexedDB in your browser. Reopening the same document at the same browser origin offers stored drafts for recovery. Restore a draft to review it before saving, or discard the drafts to use the disk version. If the file changed since the draft was created, recovery requires the same Reload or Overwrite choice as a save conflict.

Each editing session keeps a separate draft. Saving removes that session's draft. Browser storage failures show a warning and leave disk saving available. Draft recovery depends on browser storage, its quota, and completion of the storage transaction. Clearing browser data removes drafts. Keep the page open until a disk save succeeds when recovery storage is unavailable. The app also warns before leaving with unsaved changes.

Save requests time out after 15 seconds and offer Retry save. A timed-out request may have reached disk. A retry uses the original ETag and can report a conflict, so review the disk version before overwriting it.

A load error offers Retry. Start the local server if it is unreachable, check file permissions if it cannot read the file, or fix invalid JSON and schema errors before retrying.

## Performance and native input

Run the browser performance scenarios separately when collecting measurements.

```sh
pnpm test:performance
```

Each scenario attaches a JSON report with host and browser details. The 5,000-line note records 100 input-to-DOM samples after five warmups, including tree and history updates. Browser draft recovery is enabled during these scenarios, but the input-to-DOM measurement does not wait for its asynchronous storage transaction. It excludes physical input, native IME, and painting. The 1,000-row level records navigation-to-ready time and DOM size. Measurements use the development client and report the 8 ms input target without enforcing it as a timing assertion. Run on representative hardware before deciding whether to add virtualization.

Follow [the native IME checks](docs/ime-checks.md) on macOS and Windows.

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

GET responses include `X-Document-Id`, a hash of the canonical document path used to identify browser drafts. The ID stays the same across saves and server restarts. Documents opened on the same port have different IDs when their paths differ. Browser storage remains separate for each origin, so changing the port requires returning to the original origin to recover its drafts.
