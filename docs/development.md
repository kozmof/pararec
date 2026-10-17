# Development

Build, change, and test Pararec from source. Run the commands in this guide
from the repository root unless noted otherwise. For everyday use, see the
[application guide](../README.md).

## Setup

Use Zig 0.16.0, Node.js 26, and pnpm 10.17.1.

Install dependencies and build the client and local server.

```sh
pnpm install
pnpm build
```

## Run a local build

```sh
pnpm start
```

Open `http://127.0.0.1:4545`. The command opens `document.json` in the repository
root and serves the client embedded in `local/zig-out/bin/pararec`. On Windows,
the executable is `local/zig-out/bin/pararec.exe`. Run `pnpm preview` to build
and start in one command.

Use `--static ./dist` with the executable to serve client files from a directory.
Direct `zig build` commands in `local/` require an existing client build and
Node.js to generate the embedded asset manifest. Run `pnpm build:client` first.

## Development server

Start Vite, the CSS watcher, and the local server together.

```sh
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite forwards `/api` requests to the local server on
port 4545. The development server uses `document.json` in the repository root.
The production client build is written to `dist/`.

| Location                  | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `client/src/components/`  | Notebook layout, menus, and cell editing.                         |
| `client/src/lib/editor/`  | Reed text stores, editor layout, selection, and input.            |
| `client/src/lib/tree/`    | Recursive document structure and operations.                      |
| `client/src/lib/history/` | Undo and redo.                                                    |
| `client/src/lib/render/`  | Markdown parsing, KaTeX rendering, and rendered link annotations. |
| `client/src/lib/api/`     | Document requests and autosave.                                   |
| `local/src/`              | Zig HTTP server, schema validation, file storage, and locking.    |
| `tests/`                  | API, browser, production, and performance checks.   |

## Custom renderers

Custom render types must be listed in `config.renderTypes` and registered in
application code. A configured type without a registered renderer uses the
plain text view. See the [rendering guide](rendering.md) for registration
and render-setting operations, and the [document format](document-format.md)
for schema details.

## Testing

Run type checks, lint, unit tests, native server tests, and API tests.

```sh
pnpm check
pnpm lint
pnpm test:unit
pnpm test:local
pnpm test:api
```

Install Chromium and WebKit before running browser tests. Release tests build
the application and exercise the production server.

```sh
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
pnpm test:release
```

Run performance scenarios separately when collecting measurements.

```sh
pnpm test:performance
```

Run all automated readiness checks with `pnpm test:readiness`. CI runs these
checks on Linux, macOS, and Windows for pushes and pull requests.

Native IME testing on macOS and Windows remains a future manual testing task.
It is not a release gate.

## Release packages

Build an archive containing the executable for your current OS and architecture.

```sh
pnpm package:release
```

The archive and its SHA-256 checksum are written to `release/`. Extract the
archive, run `./pararec open notes.json`, and open `http://127.0.0.1:4545`.
On Windows, run `.\pararec.exe open notes.json`.

CI temporarily packages only Linux binaries for beta releases. Automated tests
still run on Linux, macOS, and Windows. To resume packaging the other platforms,
remove the Linux-only conditions from the packaging and release artifact upload
steps in `.github/workflows/ci.yml`.

Tag builds create a draft GitHub release after the automated tests pass. Review
the draft before publishing it.

## Server limits

The server listens only on `127.0.0.1`. It accepts at most 16 connections and
closes each connection after 30 seconds, including incomplete requests.
Excess connections close immediately. Document requests wait for one shared
permit before reading or parsing data.

Documents support up to 64 nested container levels. Uploads, files read from
disk, and formatted saves are limited to 128 MiB.

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

To update a document, replace the creation header with `If-Match` containing the
ETag from GET. A stale ETag returns `412`. PUT requires the matching Origin
header, including for command-line clients.

The server validates the schema, writes formatted JSON through an atomic
replacement, and keeps the previous bytes in `<document>.bak`. It holds an
operating system lock on `<document>.lock` for its lifetime. Another Pararec
process cannot open the same canonical document path, including a symbolic link
to that path. The lock releases when the process exits or crashes. Leave the
lock file in place. Its presence alone does not mean the document is locked.

The server checks the file immediately before replacement and rejects changes
detected while preparing the save. Programs that ignore Pararec's lock can still
change the file between that final check and replacement. Avoid editing the
file from another program during a save. Open documents through one canonical
path and avoid hard-link aliases.
