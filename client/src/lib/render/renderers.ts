import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/markdown";
import { SvelteMap } from "svelte/reactivity";

import { escapeHTML, RenderAnnotations, type RenderOptions } from "./annotations.js";
export { escapeHTML, type RenderOptions } from "./annotations.js";

/** Custom renderers return trusted HTML and must escape untrusted source text. */
export type Renderer = (source: string, options?: RenderOptions) => string;

const markdown = parser.configure({
  defineNodes: ["InlineMath", "DisplayMath"],
  parseInline: [
    {
      name: "Math",
      before: "Escape",
      parse(cx, next, pos) {
        if (next !== 36) return -1;
        const size = cx.char(pos + 1) === 36 ? 2 : 1;
        for (let at = pos + size; at < cx.end; at++) {
          if (cx.char(at) === 92) {
            at++;
            continue;
          }
          if (cx.char(at) !== 36 || (size === 2 && cx.char(at + 1) !== 36)) continue;
          if (at === pos + size) return -1;
          return cx.addElement(cx.elt(size === 2 ? "DisplayMath" : "InlineMath", pos, at + size));
        }
        return -1;
      },
    },
  ],
});

export function renderKatex(source: string, displayMode = true, options?: RenderOptions): string {
  return new RenderAnnotations(source, options).math(source, 0, displayMode);
}

function safeURL(value: string): string {
  const url = value.replace(/^<|>$/g, "").trim();
  // Reject control characters before checking a URL scheme.
  if (Array.from(url).some((char) => char.charCodeAt(0) <= 32)) return "";
  return /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/i.test(url) || !/[:\\]/.test(url)
    ? escapeHTML(url)
    : "";
}

export function renderMarkdown(source: string, options?: RenderOptions): string {
  const annotations = new RenderAnnotations(source, options);
  function children(node: SyntaxNode): string {
    let html = "",
      at = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      html += annotations.text(at, child.from) + render(child);
      at = child.to;
    }
    return html + annotations.text(at, node.to);
  }
  function render(node: SyntaxNode): string {
    return renderNode(node) + annotations.finish(node.to);
  }
  function renderNode(node: SyntaxNode): string {
    const raw = source.slice(node.from, node.to),
      name = node.name;
    if (name === "InlineMath" || name === "DisplayMath") {
      const size = name === "DisplayMath" ? 2 : 1;
      return annotations.math(raw.slice(size, -size), node.from + size, size === 2, node.to);
    }
    if (name === "InlineCode")
      return annotations.atom(
        `<code>${escapeHTML(raw.replace(/^(`+)([\s\S]*?)\1$/, "$2").replace(/\n/g, " "))}</code>`,
        node.from,
        node.to,
      );
    if (name === "FencedCode" || name === "CodeBlock") {
      const lines: string[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling)
        if (child.name === "CodeText") lines.push(annotations.text(child.from, child.to));
      return `<pre><code>${lines.join("\n")}</code></pre>`;
    }
    if (name === "Link" || name === "Image") {
      const url = node.getChild("URL");
      if (!url) return annotations.atom(escapeHTML(raw), node.from, node.to);
      const labelEnd = raw.indexOf("]");
      const label = raw.slice(name === "Image" ? 2 : 1, labelEnd);
      if (name === "Image")
        return annotations.atom(
          `<img src="${safeURL(source.slice(url.from, url.to))}" alt="${escapeHTML(label)}">`,
          node.from,
          node.to,
        );
      const labelHTML = annotations.deferEndings(() => {
        const start = node.from + 1,
          end = node.from + labelEnd;
        let at = start,
          html = "";
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (child.from < start || child.to > end) continue;
          html += annotations.text(at, child.from) + render(child);
          at = child.to;
        }
        return html + annotations.text(at, end);
      });
      return `<a href="${safeURL(source.slice(url.from, url.to))}" rel="noopener noreferrer">${labelHTML}</a>`;
    }
    if (
      /^(?:HeaderMark|EmphasisMark|CodeMark|QuoteMark|ListMark|LinkMark|URL|LinkTitle)$/.test(name)
    )
      return "";
    if (name === "Entity") {
      const decoder = document.createElement("textarea");
      decoder.innerHTML = raw;
      return annotations.atom(escapeHTML(decoder.value), node.from, node.to);
    }
    if (name === "Autolink") {
      const label = raw.slice(1, -1);
      return `<a href="${safeURL(label.includes(":") ? label : `mailto:${label}`)}" rel="noopener noreferrer">${annotations.atom(escapeHTML(label), node.from, node.to)}</a>`;
    }
    if (name === "Escape") return annotations.atom(escapeHTML(raw.slice(1)), node.from, node.to);
    if (name === "HardBreak") return "<br>";
    if (name === "HorizontalRule") return "<hr>";
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
    const tag = heading
      ? `h${heading[1]}`
      : (
          {
            Paragraph: "p",
            Emphasis: "em",
            StrongEmphasis: "strong",
            Blockquote: "blockquote",
            BulletList: "ul",
            OrderedList: "ol",
            ListItem: "li",
          } as Record<string, string>
        )[name];
    if (tag) return `<${tag}>${children(node)}</${tag}>`;
    if (name === "Document") return children(node);
    return annotations.atom(escapeHTML(raw), node.from, node.to);
  }
  return render(markdown.parse(source).topNode);
}

const renderers = new SvelteMap<string, Renderer>([
  ["none", escapeHTML],
  ["markdown", renderMarkdown],
  ["katex", (source, options) => renderKatex(source, true, options)],
]);
/** Registration is reactive. Dispose to restore the previous renderer. */
export function registerRenderer(name: string, renderer: Renderer): () => void {
  if (!name.trim() || name === "none") throw new Error("Invalid renderer name");
  const previous = renderers.get(name);
  renderers.set(name, renderer);
  return () => {
    if (renderers.get(name) !== renderer) return;
    if (previous) renderers.set(name, previous);
    else renderers.delete(name);
  };
}
export function getRenderer(name: string): Renderer | undefined {
  return renderers.get(name);
}

export function listRenderTypes(): string[] {
  return [...renderers.keys()];
}
