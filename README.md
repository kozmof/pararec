# Pararec

Pararec is a recursive two-column notebook that saves notes in a local JSON file.
Each row has one or more left notes and a right note that can contain child rows.
Notes support plain text, Markdown, KaTeX formulas, and links to other cells.

Pararec runs on your own computer. Public hosting and shared remote access are
outside its supported scope.

## Install

Download the beta for Linux on Intel or AMD 64-bit computers (x86-64).

1. Open the [releases page](https://github.com/kozmof/pararec/releases).
2. Download `pararec-linux-x64.tar.gz` from the beta release assets.
3. Extract the archive into a folder where you want to keep Pararec.

```sh
tar -xzf pararec-linux-x64.tar.gz
```

## Open a notebook

Open a terminal in the folder containing the extracted executable and run it.

```sh
./pararec open notes.json
```

Open [http://127.0.0.1:4545](http://127.0.0.1:4545) in your browser. Keep the
terminal open while using Pararec.

The command opens `notes.json` in the terminal's current folder. If the file
does not exist, Pararec starts with an empty notebook and creates it on the
first save. Its parent folder must already exist. To open a notebook elsewhere,
replace `notes.json` with its path. Put paths containing spaces in quotes.

Choose another port if 4545 is already in use.

```sh
./pararec open notes.json --port 4546
```

Then open `http://127.0.0.1:4546`.

To stop Pararec, save your changes, wait for the save status to confirm them,
and press Ctrl+C in the terminal. Restart it with the same command to reopen
your notebook.

## Your files

Your notes stay in the JSON file you opened. Copy that file to back it up or
move it to another computer. Pararec keeps the previous saved version beside it
as `notes.json.bak`.

Pararec also creates `notes.json.lock`. Leave this file in place. Its presence
does not mean Pararec is still running. Only one Pararec process can open the
same notebook at a time.

Documents support up to 64 nested levels and a maximum size of 128 MiB.

## Working with notes

Click a cell to edit it. Child rows appear below their parent right note.
Use Go deeper to enter a child layer and Go back to return to its parent.
An empty layer offers an Add row button.

Changes save automatically after one second without edits. Leaving a cell also
requests a save. Use Ctrl+S to save immediately and check the save status above
the notes.

If the file changes outside Pararec, saving stops and a conflict dialog offers
Reload and Overwrite. Reload replaces the current notes with the disk version.
Overwrite saves the current notes over the latest disk version.

Undo and redo cover text, row structure, links, titles, and render-type changes.
History belongs to the current session and is cleared when a document is loaded.

## Rendering

By default, the cell context menu offers None, Markdown, KaTeX, and Default.
Right-click a cell to choose a render type. Default uses the notebook's default
render setting. New notebooks use plain text.

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

These shortcuts apply while editing a note.

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

## More information

See [document settings and file format](docs/document-format.md) for notebook
configuration, or the [development guide](docs/development.md) to build, test,
and package Pararec.
