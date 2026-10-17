import katex from "katex";
import type { TextLink } from "../../schema.js";

export type RenderOptions = {
  readonly links?: readonly TextLink[];
  readonly disabled?: boolean;
};

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

type Range = { link: TextLink; start: number; end: number };

/** Convert persisted byte ranges once, then decorate the parser's UTF-16 coordinates. */
export class RenderAnnotations {
  readonly ranges: Range[];
  readonly #emitted = new Set<string>();
  #deferred = 0;
  deferEndings(render: () => string): string {
    this.#deferred++;
    try {
      return render();
    } finally {
      this.#deferred--;
    }
  }
  constructor(
    readonly source: string,
    readonly options: RenderOptions = {},
  ) {
    const links = options.links ?? [];
    const needed = new Set(links.flatMap((link) => [link.start, link.end]));
    const offsets = new Map<number, number>();
    if (links.length) {
      let byte = 0,
        char = 0;
      for (const point of source) {
        if (needed.has(byte)) offsets.set(byte, char);
        const code = point.codePointAt(0)!;
        byte += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        char += point.length;
      }
      offsets.set(byte, char);
    }
    this.ranges = links.flatMap((link) => {
      const start = offsets.get(link.start),
        end = offsets.get(link.end);
      return start !== undefined && end !== undefined && start < end ? [{ link, start, end }] : [];
    });
  }
  intersect(from: number, to: number): Range[] {
    return this.ranges.filter((range) => range.start < to && range.end > from);
  }
  wrap(html: string, ranges: readonly Range[]): string {
    return ranges.length
      ? `<span class="link-label" data-link-ids="${escapeHTML(ranges.map((range) => range.link.id).join(" "))}">${html}</span>`
      : html;
  }
  finish(to: number): string {
    return this.#deferred ? "" : this.#destinations(this.ranges.filter((range) => range.end <= to));
  }
  #destinations(ranges: readonly Range[]): string {
    return ranges
      .filter((range) => !this.#emitted.has(range.link.id))
      .map(({ link }) => {
        this.#emitted.add(link.id);
        const buttons = link.targets
          .map(
            (target, index) =>
              `${index ? '<span aria-hidden="true">,</span>' : ""}<button type="button" data-render-target="${escapeHTML(target)}" aria-label="Linked cell ${index + 1}: Go to linked cell" title="Go to linked cell"${this.options.disabled ? " disabled" : ""}>${index + 1}</button>`,
          )
          .join("");
        return `<span class="destinations" data-link-ids="${escapeHTML(link.id)}" data-editor-annotation aria-label="Linked cells">${buttons}</span>`;
      })
      .join("");
  }
  text(from: number, to: number): string {
    const ranges = this.intersect(from, to);
    if (!ranges.length) return escapeHTML(this.source.slice(from, to)) + this.finish(to);
    const cuts = [
      ...new Set([
        from,
        to,
        ...ranges.flatMap((range) => [Math.max(from, range.start), Math.min(to, range.end)]),
      ]),
    ].sort((a, b) => a - b);
    return cuts
      .slice(0, -1)
      .map((at, index) => {
        const end = cuts[index + 1];
        return (
          this.wrap(escapeHTML(this.source.slice(at, end)), this.intersect(at, end)) +
          this.finish(end)
        );
      })
      .join("");
  }
  atom(html: string, from: number, to: number): string {
    return this.wrap(html, this.intersect(from, to));
  }
  math(
    source: string,
    from: number,
    displayMode: boolean,
    extentTo = from + source.length,
  ): string {
    const to = from + source.length;
    const ranges = this.intersect(from, to);
    const plain = () =>
      katex.renderToString(source, {
        displayMode,
        throwOnError: false,
        trust: false,
        maxExpand: 1000,
      });
    if (!ranges.length) return plain();
    const cuts = [
      ...new Set([
        from,
        to,
        ...ranges.flatMap((range) => [Math.max(from, range.start), Math.min(to, range.end)]),
      ]),
    ].sort((a, b) => a - b);
    const fallback = () => {
      const html = this.wrap(plain(), ranges),
        badges = this.finish(extentTo);
      return badges && displayMode
        ? `<span class="linked-formula">${html}${badges}</span>`
        : html + badges;
    };
    for (const token of source.matchAll(/\\(?:[A-Za-z]+|[\s\S])/g)) {
      if (
        cuts.some((cut) => cut - from > token.index && cut - from < token.index + token[0].length)
      )
        return fallback();
    }
    for (let index = 0; index < cuts.length - 1; index++) {
      if (!this.intersect(cuts[index], cuts[index + 1]).length) continue;
      let depth = 0;
      const selected = source.slice(cuts[index] - from, cuts[index + 1] - from);
      for (const token of selected.matchAll(/\\(?:[A-Za-z]+|[\s\S])|[{}]/g)) {
        if (token[0] === "{") depth++;
        if (token[0] === "}" && --depth < 0) return fallback();
      }
      if (depth !== 0) return fallback();
    }
    if (
      !this.#deferred &&
      ranges.some(
        (range) =>
          range.end <= extentTo && /^\s*[_^']/.test(source.slice(Math.min(range.end, to) - from)),
      )
    )
      return fallback();
    const marks: Range[][] = [],
      badgeMarks: Range[][] = [];
    const annotated = cuts
      .slice(0, -1)
      .map((at, index) => {
        const end = cuts[index + 1],
          text = source.slice(at - from, end - from);
        const active = this.intersect(at, end);
        if (!active.length) return text;
        const id = marks.push(active) - 1;
        let html = `\\htmlData{render-mark=${id}}{${text}}`;
        const endings = this.#deferred
          ? []
          : active.filter(
              (range) =>
                Math.min(range.end, to) === end &&
                range.end <= extentTo &&
                !this.#emitted.has(range.link.id),
            );
        if (endings.length) {
          const badge = badgeMarks.push(endings) - 1;
          const numbers = endings
            .map((range) => range.link.targets.map((_, i) => i + 1).join(","))
            .join(" ");
          // Let KaTeX reserve room for each number at its actual expression boundary.
          html += `{}_{\\,\\htmlData{render-badge=${badge}}{\\text{${numbers}}}}`;
        }
        return html;
      })
      .join("");
    try {
      const html = katex.renderToString(annotated, {
        displayMode,
        throwOnError: true,
        maxExpand: 1000,
        trust: (context) => {
          if (context.command !== "\\htmlData" || Object.keys(context.attributes).length !== 1)
            return false;
          const [key, value] = Object.entries(context.attributes)[0];
          return (
            /^\d+$/.test(value) &&
            (key === "data-render-mark"
              ? marks[Number(value)] !== undefined
              : key === "data-render-badge" && badgeMarks[Number(value)] !== undefined)
          );
        },
        strict: (code) => (code === "htmlExtension" ? "ignore" : "warn"),
      });
      const template = document.createElement("template");
      template.innerHTML = html;
      const elements = template.content.querySelectorAll<HTMLElement>(
        ".katex-html [data-render-mark]",
      );
      const badges = template.content.querySelectorAll<HTMLElement>(
        ".katex-html [data-render-badge]",
      );
      const found = new Set([...elements].map((element) => Number(element.dataset.renderMark)));
      const foundBadges = new Set(
        [...badges].map((element) => Number(element.dataset.renderBadge)),
      );
      if (marks.some((_, i) => !found.has(i)) || badgeMarks.some((_, i) => !foundBadges.has(i)))
        return fallback();
      // The semantic MathML stays exactly as authored, without navigation numbers.
      const original = document.createElement("template");
      original.innerHTML = plain();
      const mathml = original.content.querySelector(".katex-mathml");
      if (!mathml) return fallback();
      template.content.querySelector(".katex-mathml")?.replaceWith(mathml);
      for (const element of elements) {
        element.classList.add("link-label");
        element.dataset.linkIds = marks[Number(element.dataset.renderMark)]
          .map((range) => range.link.id)
          .join(" ");
        element.removeAttribute("data-render-mark");
      }
      for (const element of badges) {
        element.innerHTML = this.#destinations(badgeMarks[Number(element.dataset.renderBadge)]);
        element.removeAttribute("data-render-badge");
      }
      // Expose the buttons to assistive technology, while keeping the visual math
      // hidden so it does not duplicate the original semantic MathML.
      const exposeButtons = (element: Element) => {
        if (element.matches("[data-editor-annotation]")) return;
        if (!element.querySelector("button[data-render-target]")) {
          element.setAttribute("aria-hidden", "true");
          return;
        }
        element.removeAttribute("aria-hidden");
        for (const child of element.children) exposeButtons(child);
      };
      for (const element of template.content.querySelectorAll(".katex-html"))
        exposeButtons(element);
      return template.innerHTML;
    } catch {
      return fallback();
    }
  }
}
