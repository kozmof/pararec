/** Map document line numbers to vertical positions, independent of text measurement. */
export interface VerticalLayout {
  readonly totalHeight: number;
  top(line: number): number;
  height(line: number): number;
  lineAt(y: number): number;
}

/** The imported editor's fixed-height layout, including one line for empty documents. */
export class FixedLayout implements VerticalLayout {
  readonly lineCount: number;

  constructor(
    lineCount: number,
    readonly lineHeight = 20,
  ) {
    this.lineCount = Math.max(1, lineCount);
  }

  get totalHeight(): number {
    return this.lineCount * this.lineHeight;
  }

  top(line: number): number {
    return line * this.lineHeight;
  }

  height(_line: number): number {
    return this.lineHeight;
  }

  lineAt(y: number): number {
    return Math.min(this.lineCount - 1, Math.max(0, Math.floor(y / this.lineHeight)));
  }
}

/** Mutable measured heights. Queries and height replacement use a Fenwick tree. */
export class MeasuredLayout implements VerticalLayout {
  #heights: number[];
  #tree: number[] = [];

  constructor(
    lineCount: number,
    private estimate: (line: number) => number = () => 20,
  ) {
    this.#heights = Array.from({ length: Math.max(1, lineCount) }, (_, line) =>
      this.#valid(estimate(line)),
    );
    this.#rebuild();
  }

  #valid(height: number): number {
    if (!Number.isFinite(height) || height <= 0)
      throw new RangeError("Line height must be positive and finite");
    return height;
  }

  #rebuild(): void {
    this.#tree = [0, ...this.#heights];
    for (let index = 1; index < this.#tree.length; index++) {
      const parent = index + (index & -index);
      if (parent < this.#tree.length) this.#tree[parent] += this.#tree[index];
    }
  }

  get lineCount(): number {
    return this.#heights.length;
  }
  get totalHeight(): number {
    return this.top(this.lineCount);
  }

  top(line: number): number {
    let index = Math.max(0, Math.min(this.lineCount, Math.floor(line))),
      total = 0;
    while (index > 0) {
      total += this.#tree[index];
      index -= index & -index;
    }
    return total;
  }

  height(line: number): number {
    return this.#heights[Math.min(this.lineCount - 1, Math.max(0, Math.floor(line)))];
  }

  lineAt(y: number): number {
    if (y <= 0) return 0;
    let index = 0,
      total = 0;
    let step = 2 ** Math.floor(Math.log2(this.lineCount));
    for (; step > 0; step = Math.floor(step / 2)) {
      const next = index + step;
      if (next <= this.lineCount && total + this.#tree[next] <= y) {
        index = next;
        total += this.#tree[next];
      }
    }
    return Math.min(this.lineCount - 1, index);
  }

  setHeight(line: number, px: number): boolean {
    this.#valid(px);
    if (!Number.isInteger(line) || line < 0 || line >= this.lineCount)
      throw new RangeError("Line is outside the layout");
    const delta = px - this.#heights[line];
    if (Math.abs(delta) < 0.01) return false;
    this.#heights[line] = px;
    for (let index = line + 1; index < this.#tree.length; index += index & -index)
      this.#tree[index] += delta;
    return true;
  }

  /** Splicing rebuilds the tree in O(n), preserving unaffected measured heights. */
  splice(line: number, removed: number, inserted: number): void {
    if (
      ![line, removed, inserted].every(Number.isInteger) ||
      line < 0 ||
      line > this.lineCount ||
      removed < 0 ||
      line + removed > this.lineCount ||
      inserted < 0
    )
      throw new RangeError("Invalid layout splice");
    const heights = Array.from({ length: inserted }, (_, index) =>
      this.#valid(this.estimate(line + index)),
    );
    if (removed === inserted) {
      heights.forEach((height, index) => this.setHeight(line + index, height));
      return;
    }
    this.#heights = [
      ...this.#heights.slice(0, line),
      ...heights,
      ...this.#heights.slice(line + removed),
    ];
    if (!this.#heights.length) this.#heights.push(this.#valid(this.estimate(0)));
    this.#rebuild();
  }

  /** Width or font changes invalidate measurements made under the old dimensions. */
  resetEstimates(): void {
    this.#heights = this.#heights.map((_, line) => this.#valid(this.estimate(line)));
    this.#rebuild();
  }
}

/** Estimate visual rows for unmounted lines. Unwrapped lines always occupy one row. */
export function estimateLineHeight(
  text: string,
  width: number,
  averageWidth = 7.5,
  rowHeight = 20,
  wrap = true,
): number {
  if (!wrap) return rowHeight;
  const rows = Math.max(1, Math.ceil((text.length * averageWidth) / Math.max(averageWidth, width)));
  return rows * rowHeight;
}

export type ScrollAnchor = { line: number; offset: number };

export function captureScrollAnchor(
  layout: VerticalLayout,
  scrollTop: number,
  padding = 0,
): ScrollAnchor {
  const line = layout.lineAt(Math.max(0, scrollTop - padding));
  return { line, offset: scrollTop - padding - layout.top(line) };
}

export function anchorScrollTop(layout: VerticalLayout, anchor: ScrollAnchor, padding = 0): number {
  return Math.max(
    0,
    padding + layout.top(anchor.line) + Math.min(anchor.offset, layout.height(anchor.line) - 1),
  );
}

/** Move an anchor along with surviving lines when a text edit splices the layout. */
export function spliceScrollAnchor(
  anchor: ScrollAnchor,
  from: number,
  oldEnd: number,
  newEnd: number,
  lineCount: number,
): ScrollAnchor {
  const line =
    anchor.line >= oldEnd
      ? anchor.line + newEnd - oldEnd
      : anchor.line >= from
        ? from + Math.min(anchor.line - from, Math.max(0, newEnd - from - 1))
        : anchor.line;
  return { line: Math.min(lineCount - 1, Math.max(0, line)), offset: anchor.offset };
}
