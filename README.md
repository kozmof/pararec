# Pararec

Pararec is a two-column editor for nested notes. It saves notes to a JSON file through a local server. The editor supports Japanese composition, soft wrapping, keyboard structure commands, and app-wide undo and redo.

## Setup

Use Zig 0.16.0, Node.js 26, and pnpm 10.17.1.

Install dependencies and build the application.

```sh
pnpm install
pnpm build
```

## Run

Serve one document from the repository root.

```sh
./local/zig-out/bin/pararec serve document.json
```

Open `http://127.0.0.1:4545`. A missing document opens an empty pad. Activate Add row to create the first note. Edits save after one second of inactivity and when you leave a note. Ctrl+S or Cmd+S saves immediately.

Choose another port or static directory when needed.

```sh
./local/zig-out/bin/pararec serve fixtures/flat.json --port 4546 --static ./dist
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

## Editing and recovery

Use Alt+Left and Alt+Right to switch columns. Alt+Enter splits a left note or creates a right-note sibling. Ctrl+Enter creates a child from a right note. Alt+Up and Alt+Down move notes or rows. Ctrl+. enters children and Ctrl+, returns to the parent. Ctrl+Z undoes text and structure together. Ctrl+Shift+Z or Ctrl+Y redoes an action. The editor also accepts Cmd for Ctrl shortcuts on macOS.

If the file changes outside the app, saving stops and offers Reload or Overwrite. Reload replaces your notes with the disk version and clears history. Overwrite saves your local notes against the current disk version.

Unsaved notes are also stored in the browser's IndexedDB. On reload, Restore recovers them and Discard keeps the disk version. A changed disk document requires confirmation before recovery replaces it. Keep using the same browser and origin to access that recovery snapshot. Recovery storage failures appear in the app.

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
