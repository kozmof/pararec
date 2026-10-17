# Pararec

Pararec is a recursive two-column notebook that saves notes in a local JSON file.
Each row has one or more left notes and a right note that can contain child rows.
Notes support plain text, Markdown, KaTeX formulas, and links to other cells.

Pararec runs on your own computer. Public hosting and shared remote access are
outside its supported scope.

## Setup

Use Zig 0.16.0, Node.js 26, and pnpm 10.17.1.

Install dependencies and build the client and local server.

```sh
pnpm install
pnpm build
```

## Run

Start the built application from the repository root.

```sh
pnpm start
```

Open `http://127.0.0.1:4545`. This command opens `document.json` and serves the
client from `dist/`. A missing document starts empty and is created on the first
save. Its parent directory must already exist.

Open another document or choose a different port and static directory with the CLI.

```sh
./local/zig-out/bin/pararec open notes.json --port 4546 --static ./dist
```

On Windows, use `local/zig-out/bin/pararec.exe`. Use `pnpm preview` to build and
start the default document in one command.

## Working with notes

Click a cell to edit it. Child rows appear below their parent right note.
Use Go deeper to enter a child layer and Go back to return to its parent.
An empty layer offers an Add row button.

Changes save automatically after one second without edits. Leaving a cell also
requests a save. Use Ctrl+S to save immediately and check the save status above
the notes. On macOS, use Cmd in place of Ctrl.

If the file changes outside Pararec, saving stops and a conflict dialog offers
Reload and Overwrite. Reload replaces the current notes with the disk version.
Overwrite saves the current notes over the latest disk version.

Undo and redo cover text, row structure, links, titles, and render-type changes.
History belongs to the current session and is cleared when a document is loaded.

## Rendering

By default, the cell context menu offers None, Markdown, KaTeX, and Default.
Right-click a cell to choose a render type. Default inherits `config.renderType`
from the document. Documents without a render setting use `"none"` for plain text.

Click a rendered cell to edit its source. Opening its context menu keeps the
source visible. Escape returns focus to the editor. Leaving the cell restores
its rendered preview. Choosing a render type from the menu shows the preview.

Markdown supports headings, lists, emphasis, quotes, code, links, and images.
Use a space after heading markers, such as `# Quadratic formula`. Inline math uses
`$...$` and display math uses `$$...$$`. Code spans and code blocks keep formula
delimiters literal. Raw HTML is displayed as text.

Paste this example into a cell set to Markdown, then click outside the cell.

```markdown
# Quadratic formula

For $ax^2 + bx + c = 0$ with $a \ne 0$:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$
```

KaTeX mode treats the whole cell as a display formula, without dollar delimiters.
Wide display formulas can scroll horizontally.

Custom render types must be listed in `config.renderTypes` and registered in
application code. A configured type without a registered renderer uses the
plain text view. See the [rendering guide](docs/rendering.md) for registration
and render-setting operations.

## Linking text to cells

Link a source-text selection to one or more destination cells.

1. Click the cell to edit its source and select the text to link.
2. Right-click the selection and choose Start linking.
3. Click destination cells. Click a selected cell again to remove it from the selection.
4. Choose Done to create the link, or Cancel to discard it.

Linked text stays highlighted in the source editor and in Markdown and KaTeX
previews. Small destination numbers appear at the lower right of a label.
Each label numbers its own destinations from 1. Click a number to navigate to
that destination. Right-click a label or a destination number to remove the
label or one of its destinations.

For example, link `b^2` inside the quadratic formula's source to highlight the
rendered expression. If a selection splits TeX syntax and cannot be annotated
safely, the preview labels the whole formula instead.

## Keyboard shortcuts

These shortcuts apply while editing a note. On macOS, use Cmd in place of Ctrl.

| Shortcut                    | Action                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Arrow keys                  | Move the cursor. At a note boundary, move to the next cell in that direction.                                                       |
| Shift+Left / Shift+Right    | Move between cells and columns from any cursor position.                                                                            |
| Shift+Up / Shift+Down       | Move to the cell above or below from any cursor position.                                                                           |
| Enter                       | Insert a line break.                                                                                                                |
| Shift+Enter                 | Insert an empty sibling row below and focus the same column. At the start of a full-width parent note, prepend a child row instead. |
| Shift+Alt+Enter             | Insert an empty row above the current record and focus the same column.                                                             |
| Alt+Enter in a left cell    | Split at the cursor into a new left cell in the same row.                                                                           |
| Ctrl+Enter in a right cell  | Add an empty child row and focus its right cell.                                                                                    |
| Shift+Delete                | Remove the current row, including its children.                                                                                     |
| Alt+Delete in a left cell   | Remove that left cell, unless it is the last one in the row.                                                                        |
| Ctrl+Delete in a right cell | Remove all child rows of that note.                                                                                                 |
| Alt+Up / Alt+Down           | Move the current left cell or row up or down.                                                                                       |
| Ctrl+A                      | Select all text in the current note.                                                                                                |
| Ctrl+C / Ctrl+X / Ctrl+V    | Copy, cut, or paste text.                                                                                                           |
| Ctrl+S                      | Save immediately.                                                                                                                   |
| Ctrl+Z                      | Undo an action.                                                                                                                     |
| Ctrl+Shift+Z / Ctrl+Y       | Redo an action.                                                                                                                     |

## Document format and configuration

Documents use version 1 of the JSON schema. This example shows an empty document
with the default settings and a custom title.

```json
{
  "version": 1,
  "title": "My notes",
  "config": {
    "renderType": "none",
    "renderTypes": ["none", "markdown", "katex"],
    "showTitles": true,
    "maxWidth": 1100,
    "outerWidthRate": { "left": 35, "right": 65 },
    "innerWidthRate": { "left": 35, "right": 65 }
  },
  "root": []
}
```

| Field                   | Default                         | Effect                                                           |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `title`                 | File name without its extension | Editable document title.                                         |
| `config.renderType`     | `"none"`                        | Default renderer for cells without an override.                  |
| `config.renderTypes`    | `["none", "markdown", "katex"]` | Allowed render types, in context-menu order.                     |
| `config.showTitles`     | `true`                          | Show the document title.                                         |
| `config.maxWidth`       | `1100`                          | Maximum width of the notes area in pixels.                       |
| `config.outerWidthRate` | `{ "left": 35, "right": 65 }`   | Relative column widths for rows in the current layer.            |
| `config.innerWidthRate` | `{ "left": 35, "right": 65 }`   | Relative column widths for child rows shown inside a right cell. |

Omitted settings receive their defaults on load. Render-type names must be
nonempty strings. The allowed list must be nonempty and contain no duplicates.
The default renderer and every explicit cell renderer must belong to that list.

Width values must be positive, finite numbers. Column rates are proportions and
do not need to total 100. For example, `{ "left": 1, "right": 2 }` makes the right
column twice as wide as the left.

Each row has an `id`, a nonempty `left` array, and a `right` object. A content
object has an `id`, `text`, and an optional `renderType` override. The right
content object also has a `children` array of rows. Omit a cell's `renderType` to
inherit the document default. Set it to `"none"` to keep that cell as plain text.
IDs must be unique across the document's rows and cells.

An optional top-level `links` array stores text ranges and destination cell IDs.
Ranges use UTF-8 byte offsets into normalized source text. See
[the client schema](client/src/schema.ts) and [sample documents](fixtures/flat.json).

## Development

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
| `tests/`                  | API, browser, production, performance, and native-input checks.   |

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

Run all readiness checks with `pnpm test:readiness`. Its native IME check requires
manual evidence recorded in [the native input checklist](docs/ime-checks.md).
Use `pnpm test:native-ime` to check that evidence on its own.

CI runs automated checks on Linux, macOS, and Windows for pushes and pull
requests. Tag pushes and manual workflow runs also require the
`release-readiness` job after all three operating systems pass. That job checks
native IME evidence with full Git history.

## Server limits

The server listens only on `127.0.0.1`. It accepts at most 16 connections and
closes each connection after 30 seconds, including incomplete requests.
Excess connections close immediately. Document requests wait for one shared
permit before reading or parsing data.

Documents support up to 64 nested container levels. Uploads, files read from disk, and formatted saves are limited to 128 MiB.

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
