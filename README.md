# Pararec

Pararec is a recursive two-column note app.

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

Open `http://127.0.0.1:4545`. A missing document opens an empty pad. Activate Add row to create the first note. Edits save after one second of inactivity and when you leave a note. Ctrl+S or Cmd+S saves immediately.

Choose another port or static directory when needed.

```sh
./local/zig-out/bin/pararec open fixtures/flat.json --port 4546 --static ./dist
```

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

## Editing and saving

While editing a note, use the following shortcuts. On macOS, use Cmd in place of Ctrl.

| Shortcut | Action |
| --- | --- |
| Arrow keys | Move the cursor within text. At a note boundary, move to the next cell in that direction. |
| Shift+Left / Shift+Right | Move between cells and columns from any cursor position. |
| Shift+Up / Shift+Down | Move to the cell above or below from any cursor position. |
| Enter | Insert a line break. |
| Shift+Enter | Split at the cursor into a new sibling row with left and right cells. Move the remaining text to the same column in the new row. |
| Ctrl+Enter in a left cell | Split at the cursor into a new left cell in the same row. |
| Ctrl+Enter in a right cell | Add an empty child row and focus its right cell. |
| Alt+Up / Alt+Down | Move the current left cell or row up or down. |
| Ctrl+A | Select all text in the current note. |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, or paste text. |
| Ctrl+S | Save immediately. |
| Ctrl+Z | Undo text or structure changes. |
| Ctrl+Shift+Z / Ctrl+Y | Redo an action. |

If the file changes outside the app, saving stops and offers Reload or Overwrite. Reload replaces your notes with the disk version and clears history. Overwrite saves your local notes against the current disk version.

Unsaved edits stay in memory until saved to the document file. Reloading or closing the page can lose edits that have not been saved. The app warns before leaving with unsaved changes.

A load error offers Retry. Start the local server if it is unreachable, check file permissions if it cannot read the file, or fix invalid JSON and schema errors before retrying.

## Performance and native input

Run the browser performance scenarios separately when collecting measurements.

```sh
pnpm test:performance
```

Each scenario attaches a JSON report with host and browser details. The 5,000-line note records 100 input-to-DOM samples after five warmups, including tree and history updates. It excludes physical input, native IME, and painting. The 1,000-row level records navigation-to-ready time and DOM size. Measurements use the development client and report the 8 ms input target without enforcing it as a timing assertion. Run on representative hardware before deciding whether to add virtualization.

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

The server validates the schema, writes formatted JSON through an atomic replacement, and keeps the previous bytes in `<document>.bak`. Its mutex coordinates requests to this server. An external process can still change the file between the precondition check and replacement.
