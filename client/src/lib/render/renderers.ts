import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/markdown";
import katex from "katex";
import { SvelteMap } from "svelte/reactivity";

/** Custom renderers return trusted HTML and must escape untrusted source text. */
export type Renderer = (source: string) => string;
export const escapeHTML = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );

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

export function renderKatex(source: string, displayMode = true): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    trust: false,
    maxExpand: 1000,
  });
}

function safeURL(value: string): string {
  const url = value.replace(/^<|>$/g, "").trim();
  // Reject control characters before checking a URL scheme.
  if (Array.from(url).some((char) => char.charCodeAt(0) <= 32)) return "";
  return /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/i.test(url) || !/[:\\]/.test(url)
    ? escapeHTML(url)
    : "";
}

export function renderMarkdown(source: string): string {
  function children(node: SyntaxNode): string {
    let html = "",
      at = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      html += escapeHTML(source.slice(at, child.from)) + render(child);
      at = child.to;
    }
    return html + escapeHTML(source.slice(at, node.to));
  }
  function render(node: SyntaxNode): string {
    const raw = source.slice(node.from, node.to),
      name = node.name;
    if (name === "InlineMath" || name === "DisplayMath") {
      const size = name === "DisplayMath" ? 2 : 1;
      return renderKatex(raw.slice(size, -size), size === 2);
    }
    if (name === "InlineCode")
      return `<code>${escapeHTML(raw.replace(/^(`+)([\s\S]*?)\1$/, "$2").replace(/\n/g, " "))}</code>`;
    if (name === "FencedCode" || name === "CodeBlock") {
      const lines: string[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling)
        if (child.name === "CodeText") lines.push(source.slice(child.from, child.to));
      return `<pre><code>${escapeHTML(lines.join("\n"))}</code></pre>`;
    }
    if (name === "Link" || name === "Image") {
      const url = node.getChild("URL");
      if (!url) return escapeHTML(raw);
      const labelEnd = raw.indexOf("]");
      const label = raw.slice(name === "Image" ? 2 : 1, labelEnd);
      if (name === "Image")
        return `<img src="${safeURL(source.slice(url.from, url.to))}" alt="${escapeHTML(label)}">`;
      let labelHTML = "";
      // Include plain text gaps and inline formatting in the label.
      const start = node.from + 1,
        end = node.from + labelEnd;
      let at = start;
      labelHTML = "";
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.from < start || child.to > end) continue;
        labelHTML += escapeHTML(source.slice(at, child.from)) + render(child);
        at = child.to;
      }
      labelHTML += escapeHTML(source.slice(at, end));
      return `<a href="${safeURL(source.slice(url.from, url.to))}" rel="noopener noreferrer">${labelHTML}</a>`;
    }
    if (
      /^(?:HeaderMark|EmphasisMark|CodeMark|QuoteMark|ListMark|LinkMark|URL|LinkTitle)$/.test(name)
    )
      return "";
    if (name === "Entity") {
      const decoder = document.createElement("textarea");
      decoder.innerHTML = raw;
      return escapeHTML(decoder.value);
    }
    if (name === "Autolink") {
      const label = raw.slice(1, -1);
      return `<a href="${safeURL(label.includes(":") ? label : `mailto:${label}`)}" rel="noopener noreferrer">${escapeHTML(label)}</a>`;
    }
    if (name === "Escape") return escapeHTML(raw.slice(1));
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
    return escapeHTML(raw);
  }
  return render(markdown.parse(source).topNode);
}

const renderers = new SvelteMap<string, Renderer>([
  ["none", escapeHTML],
  ["markdown", renderMarkdown],
  ["katex", renderKatex],
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
