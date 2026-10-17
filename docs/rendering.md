# Cell rendering

Cells support plain text, Markdown, and KaTeX previews. Focus a cell to edit its source.

Right-click a cell to choose its renderer or inherit the document default.

`Config.renderType` and `Config.renderTypes` are required in the application schema.
Older files receive `"none"` and `["none", "markdown", "katex"]` when loaded.
The default renderer and every explicit cell renderer must appear in
`config.renderTypes`. The context menu offers the types in that configured order. Set `renderType` on a left or
right content object to override the document setting. Omit the cell field to
inherit the document setting. An explicit `"none"` keeps that cell as plain text.

Markdown supports headings, lists, quotes, code, links, and images. Write inline
math as `$x^2$` and display math as `$$\frac{1}{2}$$`. Code spans and code blocks
keep formula delimiters literal. The `"katex"` renderer treats the whole cell as
a display formula. Invalid formulas show an error without interrupting editing.
Raw HTML is displayed as text.

Use `setRenderType` and `setDefaultRenderType` tree operations to change these
settings with undo support. Omit the value of `setRenderType` to restore cell
inheritance. `setDefaultRenderType` requires a value. Use `setRenderTypes` to
change the allowed list. Removing a type that the default or a cell uses is rejected.

Add a custom type to the document configuration before assigning it to a cell.

```json
{
  "renderType": "none",
  "renderTypes": ["none", "markdown", "katex", "notice"]
}
```

Register its renderer from application code.

```ts
import { escapeHTML, registerRenderer } from "../lib/render/renderers.js";

const unregister = registerRenderer("notice", source =>
  `<aside>${escapeHTML(source)}</aside>`
);

// Remove the registration when the extension is unloaded.
unregister();
```

Renderers receive source text and return trusted HTML. Escape untrusted text
before including it in HTML. Registrations update existing previews. Unknown
renderer names listed in the configuration fall back to the plain text view
and remain in saved documents. Registration alone does not add a type to a
document's allowed list.
Registration code belongs to the application and is not stored in document files.

Text-link annotations appear in the source editor and in Markdown and KaTeX
previews. Link `c^2` inside `$E = mc^2# Cell rendering

Cells support plain text, Markdown, and KaTeX previews. Focus a cell to edit its source.

Right-click a cell to choose its renderer or inherit the document default.

`Config.renderType` and `Config.renderTypes` are required in the application schema.
Older files receive `"none"` and `["none", "markdown", "katex"]` when loaded.
The default renderer and every explicit cell renderer must appear in
`config.renderTypes`. The context menu offers the types in that configured order. Set `renderType` on a left or
right content object to override the document setting. Omit the cell field to
inherit the document setting. An explicit `"none"` keeps that cell as plain text.

Markdown supports headings, lists, quotes, code, links, and images. Write inline
math as `$x^2$` and display math as `$$\frac{1}{2}$$`. Code spans and code blocks
keep formula delimiters literal. The `"katex"` renderer treats the whole cell as
a display formula. Invalid formulas show an error without interrupting editing.
Raw HTML is displayed as text.

Use `setRenderType` and `setDefaultRenderType` tree operations to change these
settings with undo support. Omit the value of `setRenderType` to restore cell
inheritance. `setDefaultRenderType` requires a value. Use `setRenderTypes` to
change the allowed list. Removing a type that the default or a cell uses is rejected.

Add a custom type to the document configuration before assigning it to a cell.

```json
{
  "renderType": "none",
  "renderTypes": ["none", "markdown", "katex", "notice"]
}
```

Register its renderer from application code.

```ts
import { escapeHTML, registerRenderer } from "../lib/render/renderers.js";

const unregister = registerRenderer("notice", source =>
  `<aside>${escapeHTML(source)}</aside>`
);

// Remove the registration when the extension is unloaded.
unregister();
```

Renderers receive source text and return trusted HTML. Escape untrusted text
before including it in HTML. Registrations update existing previews. Unknown
renderer names listed in the configuration fall back to the plain text view
and remain in saved documents. Registration alone does not add a type to a
document's allowed list.
Registration code belongs to the application and is not stored in document files.

Text-link annotations appear in Markdown and KaTeX previews. Create a link on
`c^2` in the source to highlight the rendered c² expression.
Use the numbered destination buttons to follow a link, or right-click its
highlight to remove a label or destination. Each math destination number appears
beside its linked expression. If a selection splits TeX syntax and cannot be
highlighted safely, the preview labels the whole formula instead.

Selecting link targets temporarily shows source text instead of rendered previews.
Custom renderers receive an optional second argument with `links` and `disabled`
fields. Their implementation controls how those annotations appear.
