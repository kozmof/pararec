# Cell rendering

Cells support plain text, Markdown, and KaTeX previews. Focus a cell to edit its source.
Right-click a cell to choose its renderer or inherit the document default.
Opening the context menu while editing keeps the source visible. Escape returns
focus to the editor. Leaving the cell restores its rendered preview.

## Render settings

`Config.renderType` and `Config.renderTypes` are required in the application schema.
Older files receive `"none"` and `["none", "markdown", "katex"]` when loaded.
The default renderer and every explicit cell renderer must appear in
`config.renderTypes`. The context menu offers the types in that configured order.

Set `renderType` on a left or right content object to override the document
setting. Omit the cell field to inherit the document setting. An explicit
`"none"` keeps that cell as plain text.

Markdown supports headings, lists, quotes, code, links, and images. Write inline
math as `$x^2$` and display math as `$$\frac{1}{2}$$`. Code spans and code blocks
keep formula delimiters literal. The `"katex"` renderer treats the whole cell as
a display formula without dollar delimiters. Invalid formulas show an error
without interrupting editing. Raw HTML is displayed as text.

Use `setRenderType` and `setDefaultRenderType` tree operations to change these
settings with undo support. Omit the value of `setRenderType` to restore cell
inheritance. `setDefaultRenderType` requires a value. Use `setRenderTypes` to
change the allowed list. Removing a type that the default or a cell uses is rejected.

## Custom renderers

Add a custom type to the document configuration before assigning it to a cell.

```json
{
  "renderType": "none",
  "renderTypes": ["none", "markdown", "katex", "notice"]
}
```

Register its renderer from application code. Adjust the import path for the calling module.

```ts
import { escapeHTML, registerRenderer } from "../lib/render/renderers.js";

const unregister = registerRenderer("notice", source =>
  `<aside>${escapeHTML(source)}</aside>`
);

// Remove the registration when the extension is unloaded.
unregister();
```

Renderers receive source text and return trusted HTML. Escape untrusted text
before including it in HTML. Registrations update existing previews. A renderer
name listed in the configuration without a registered implementation uses the
plain text view and remains in saved documents. Registration alone does not
add a type to a document's allowed list. Registration code belongs to the
application and is not stored in document files.

Custom renderers receive an optional second argument with `links` and `disabled`
fields. Their implementation controls how those annotations appear.

## Linked labels

Text-link annotations appear in the source editor and in Markdown and KaTeX
previews. Create a link on `c^2` inside `$E = mc^2$` to highlight the rendered expression.
Destination numbers appear at the lower right of each linked label. Each label
numbers its own destinations from 1.

Click a number to follow its link. Right-click a highlight or number to remove
a label or destination. Selecting link targets temporarily shows source text
instead of rendered previews.

If a selection splits TeX syntax and cannot be annotated safely, the preview
labels the whole formula instead.
