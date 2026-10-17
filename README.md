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
3. Extract the archive.

```sh
tar -xzf pararec-linux-x64.tar.gz
```

## Open a notebook

```sh
./pararec open notes.json
```

Open [http://127.0.0.1:4545](http://127.0.0.1:4545) in your browser.

Choose another port if 4545 is already in use.

```sh
./pararec open notes.json --port 4546
```

## Rendering

Right-click a cell to choose a render type.

In Markdown, inline math uses `$...$` and display math uses `$$...$$`. 

```markdown
# Quadratic formula

For $ax^2 + bx + c = 0$ with $a \ne 0$:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$
```

## Linking text to cells

Link a source-text selection to one or more destination cells.

1. Click the cell to edit its source and select the text to link.
2. Right-click the selection and choose Start linking.
3. Click destination cells. Click a selected cell again to remove it from the selection.
4. Choose Done to create the link, or Cancel to discard it.

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
