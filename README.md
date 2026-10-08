# Pararec

Pararec is a two-column editor for nested notes. The local document server is implemented. The client currently shows a connection check while the editor is being built.

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

Open `http://127.0.0.1:4545`. A missing document returns `404` until the first successful creation request. The editor and its save controls are not implemented yet.

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
pnpm test:unit
pnpm test:local
pnpm test:api
```

Install Chromium and WebKit before running browser smoke tests.

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

CI installs browser system dependencies and runs all these checks. Browser downloads require access to Playwright's download hosts.

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
