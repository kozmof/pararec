import type { VisibleLine } from "./document-store.svelte.js";

type RenderedLine = VisibleLine & { key: number };

/** Keep unchanged lines mounted when their line numbers shift after an edit. */
export class LineIdentity {
  #previous: RenderedLine[] = [];
  #nextKey = 0;

  reconcile(lines: VisibleLine[]): RenderedLine[] {
    const previous = this.#previous;
    if (previous.length && lines.length && previous[0].lineNumber !== lines[0].lineNumber) {
      const byLine = new Map(previous.map((line) => [line.lineNumber, line]));
      const next = lines.map((line) => {
        const old = byLine.get(line.lineNumber);
        return old && old.content === line.content
          ? old
          : { ...line, key: old?.key ?? this.#nextKey++ };
      });
      this.#previous = next;
      return next;
    }
    let first = 0;
    while (
      first < previous.length &&
      first < lines.length &&
      previous[first].content === lines[first].content
    )
      first++;
    let oldEnd = previous.length;
    let newEnd = lines.length;
    while (
      oldEnd > first &&
      newEnd > first &&
      previous[oldEnd - 1].content === lines[newEnd - 1].content
    ) {
      oldEnd--;
      newEnd--;
    }
    const next = lines.map((line, at) => {
      const old =
        at < first
          ? previous[at]
          : at >= newEnd
            ? previous[at + oldEnd - newEnd]
            : at < oldEnd
              ? previous[at]
              : undefined;
      return old && old.lineNumber === line.lineNumber && old.content === line.content
        ? old
        : { ...line, key: old?.key ?? this.#nextKey++ };
    });
    this.#previous = next;
    return next;
  }
}
