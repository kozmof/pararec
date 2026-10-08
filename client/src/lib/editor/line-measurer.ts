export type Point = { x: number; y: number };
export type Rect = { top: number; left: number; width: number | null; height: number };
export type VisualRow = { top: number; height: number };
export type CaretAffinity = "upstream" | "downstream";

/** Measurements relative to the line's text origin, excluding padding. */
export interface LineMeasurer {
  columnToPoint(line: number, column: number, affinity?: CaretAffinity): Point;
  pointToColumn(line: number, x: number, y: number): number;
  rangeRects(line: number, from: number, to: number | null): Rect[];
  visualRows(line: number): VisualRow[];
}

/** Fixed character widths and optional wrapping for geometry tests without browser layout. */
export function arithmeticMeasurer(
  lineText: (line: number) => string,
  cellWidth = 10,
  rowHeight = 20,
  wrapWidth = Infinity,
): LineMeasurer {
  if (!(cellWidth > 0 && rowHeight > 0 && wrapWidth >= cellWidth))
    throw new RangeError("Measurement dimensions must be positive and fit at least one cell");
  const columns = Number.isFinite(wrapWidth)
    ? Math.floor(wrapWidth / cellWidth)
    : Number.MAX_SAFE_INTEGER;
  const length = (line: number) => lineText(line).length;
  const rows = (line: number) => Math.max(1, Math.ceil(length(line) / columns));
  const point = (line: number, column: number, affinity: CaretAffinity = "downstream"): Point => {
    const at = Math.min(length(line), Math.max(0, column));
    const row = Math.min(
      rows(line) - 1,
      Math.floor(at / columns) - (affinity === "upstream" && at > 0 && at % columns === 0 ? 1 : 0),
    );
    return { x: (at - row * columns) * cellWidth, y: row * rowHeight };
  };
  return {
    columnToPoint: point,
    pointToColumn(line, x, y) {
      const row = Math.min(rows(line) - 1, Math.max(0, Math.floor(y / rowHeight)));
      return Math.min(
        length(line),
        (row + 1) * columns,
        row * columns + Math.max(0, Math.round(x / cellWidth)),
      );
    },
    visualRows(line) {
      return Array.from({ length: rows(line) }, (_, row) => ({
        top: row * rowHeight,
        height: rowHeight,
      }));
    },
    rangeRects(line, from, to) {
      const start = point(line, from);
      const end = point(line, to ?? length(line));
      const result: Rect[] = [];
      for (let row = start.y / rowHeight; row <= end.y / rowHeight; row++) {
        const left = row === start.y / rowHeight ? start.x : 0;
        const last = row === end.y / rowHeight;
        // An end at the next row's start does not select that row.
        if (last && end.x === 0 && row > start.y / rowHeight && to !== null) break;
        result.push({
          top: row * rowHeight,
          left,
          width: last
            ? to === null
              ? null
              : Math.max(0, end.x - left)
            : columns * cellWidth - left,
          height: rowHeight,
        });
      }
      return result;
    },
  };
}

type Segment = { node: Text; from: number };
type Boundary = { node: Text; offset: number };

/** Support decorated spans and IME pre-edit spans, each addressed by its data-from column. */
export function domLineMeasurer(lineElement: (line: number) => HTMLElement | null): LineMeasurer {
  function context(line: number) {
    const el = lineElement(line);
    if (!el) return null;
    const segments: Segment[] = [];
    const spans = [...el.querySelectorAll<HTMLElement>("[data-from]")];
    for (const span of spans.length ? spans : [el]) {
      let from = Number(span.dataset.from ?? 0);
      const walker = el.ownerDocument.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        segments.push({ node: node as Text, from });
        from += (node as Text).length;
      }
    }
    segments.sort((a, b) => a.from - b.from);
    const length = segments.reduce((end, { node, from }) => Math.max(end, from + node.length), 0);
    const boundary = (column: number): Boundary | null => {
      if (!segments.length) return null;
      const at = Math.max(0, Math.min(length, column));
      let low = 0,
        high = segments.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (segments[mid].from <= at) low = mid;
        else high = mid - 1;
      }
      const segment = segments[low];
      return {
        node: segment.node,
        offset: Math.max(0, Math.min(segment.node.length, at - segment.from)),
      };
    };
    const range = (from: number, to: number) => {
      const start = boundary(from),
        end = boundary(to);
      if (!start || !end) return null;
      const result = el.ownerDocument.createRange();
      result.setStart(start.node, start.offset);
      result.setEnd(end.node, end.offset);
      return result;
    };
    const rectangles = (value: Range | null): DOMRect[] => {
      if (!value) return [];
      const rects = value.getClientRects?.();
      if (rects?.length) return [...rects].filter((rect) => rect.height > 0);
      const rect = value.getBoundingClientRect?.();
      return rect && rect.height > 0 ? [rect] : [];
    };
    const initial = rectangles(range(0, 0))[0] ?? rectangles(range(0, Math.min(1, length)))[0];
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const origin = {
      x: initial?.left ?? box.left + (parseFloat(style.paddingLeft) || 0),
      y: initial?.top ?? box.top ?? 0,
    };
    const height = parseFloat(style.lineHeight) || 20;
    const point = (column: number, affinity: CaretAffinity = "downstream"): Point => {
      const at = Math.min(length, Math.max(0, column));
      const previous = rectangles(range(Math.max(0, at - 1), at)).at(-1);
      const next = rectangles(range(at, Math.min(length, at + 1)))[0];
      // A collapsed Range can choose either side of a wrap. Adjacent character rectangles
      // identify the two visual positions without changing the document offset.
      if (at > 0 && at < length && previous && next && next.top - previous.top > 1) {
        const chosen = affinity === "upstream" ? previous : next;
        return {
          x: (affinity === "upstream" ? chosen.left + chosen.width : chosen.left) - origin.x,
          y: chosen.top - origin.y,
        };
      }
      const rect = rectangles(range(at, at))[0];
      if (rect) return { x: rect.left - origin.x, y: (rect.top ?? origin.y) - origin.y };
      // Empty collapsed ranges can report the page origin. Adjacent text still supplies
      // the caret edge, including at decorated span boundaries and at the end of a line.
      if (next) return { x: next.left - origin.x, y: next.top - origin.y };
      if (previous)
        return { x: previous.left + previous.width - origin.x, y: previous.top - origin.y };
      return { x: 0, y: 0 };
    };
    const rows = (): VisualRow[] => {
      const tops = [
        ...new Set(rectangles(range(0, length)).map((rect) => (rect.top ?? origin.y) - origin.y)),
      ];
      return (tops.length ? tops : [0]).sort((a, b) => a - b).map((top) => ({ top, height }));
    };
    return { el, segments, length, range, rectangles, origin, height, point, rows };
  }

  return {
    columnToPoint(line, column, affinity) {
      return context(line)?.point(column, affinity) ?? { x: 0, y: 0 };
    },
    visualRows(line) {
      return context(line)?.rows() ?? [{ top: 0, height: 20 }];
    },
    pointToColumn(line, x, y) {
      const ctx = context(line);
      if (!ctx || !ctx.length) return 0;
      const columnOf = (node: Node | null, offset: number): number | null => {
        const segment = ctx.segments.find((segment) => segment.node === node);
        return segment ? segment.from + Math.min(segment.node.length, Math.max(0, offset)) : null;
      };
      const doc = ctx.el.ownerDocument as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const rows = ctx.rows();
      const row = rows.filter((row) => row.top <= y).at(-1) ?? rows[0];
      const screenX = ctx.origin.x + x,
        screenY = ctx.origin.y + row.top + row.height / 2;
      const hit = Number.isFinite(x) ? doc.caretPositionFromPoint?.(screenX, screenY) : null;
      const native = hit ? columnOf(hit.offsetNode, hit.offset) : null;
      if (native !== null) return native;
      const hitRange = Number.isFinite(x) ? doc.caretRangeFromPoint?.(screenX, screenY) : null;
      const webkit = hitRange ? columnOf(hitRange.startContainer, hitRange.startOffset) : null;
      if (webkit !== null) return webkit;
      let low = 0,
        high = ctx.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2),
          point = ctx.point(mid);
        if (point.y < row.top || (point.y === row.top && point.x <= x)) low = mid;
        else high = mid - 1;
      }
      const here = ctx.point(low),
        next = ctx.point(Math.min(ctx.length, low + 1), "upstream");
      return low < ctx.length && next.y === row.top && (here.y < row.top || x - here.x > next.x - x)
        ? low + 1
        : low;
    },
    rangeRects(line, from, to) {
      const ctx = context(line);
      if (!ctx) return [];
      const merged: Rect[] = [];
      for (const rect of ctx.rectangles(ctx.range(from, to ?? ctx.length))) {
        const top = (rect.top ?? ctx.origin.y) - ctx.origin.y;
        const left = rect.left - ctx.origin.x;
        const width = rect.width;
        const existing = merged.find((row) => Math.abs(row.top - top) < 1);
        if (existing) {
          const right = Math.max(existing.left + (existing.width ?? 0), left + width);
          existing.left = Math.min(existing.left, left);
          existing.width = right - existing.left;
        } else merged.push({ top, left, width, height: ctx.height });
      }
      merged.sort((a, b) => a.top - b.top);
      if (!merged.length) {
        const point = ctx.point(from);
        merged.push({ top: point.y, left: point.x, width: 0, height: ctx.height });
      }
      if (to === null) merged[merged.length - 1].width = null;
      return merged;
    },
  };
}
