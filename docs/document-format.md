# Document format and configuration

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
[the client schema](../client/src/schema.ts) and [sample documents](../fixtures/flat.json).

Return to the [application guide](../README.md).
