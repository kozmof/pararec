import { domLineMeasurer, type LineMeasurer as PointMeasurer } from "./line-measurer.js";
import type { Caret } from "./document-store.svelte.js";
import { FixedLayout, type VerticalLayout } from "./vertical-layout.js";
import { visualCaret } from "./visual-navigation.js";

/**
 * Horizontal measurement interface retained for the unchanged imported tests.
 * Production uses the point-based LineMeasurer from line-measurer.ts.
 */
export type LineMeasurer = {
  /** Pixels from the start of the line to the left edge of `column`. */
  columnToX(line: number, column: number): number;
  /** The column whose cell contains `x`, clamped to the ends of the line. */
  xToColumn(line: number, x: number): number;
};

export type Viewport = {
  scrollTop: number;
  height: number;
  lineCount: number;
} & ({ layout: VerticalLayout; lineHeight?: never } | { lineHeight: number; layout?: never });

/** The band of lines a viewport covers, widened by `overscan` at both ends. */
export function visibleRange(
  view: Viewport,
  overscan = 4,
): { startLine: number; visibleLineCount: number } {
  const layout = view.layout ?? new FixedLayout(view.lineCount, view.lineHeight);
  const firstVisible = layout.lineAt(view.scrollTop);
  const first = Math.max(0, firstVisible - overscan);
  const bottom = view.scrollTop + Math.max(0, view.height);
  let lastVisible = layout.lineAt(bottom);
  if (view.height > 0 && lastVisible > firstVisible && layout.top(lastVisible) === bottom)
    lastVisible--;
  // Keep the imported editor's overscan budget even when clipped at the document start.
  const clippedAbove = Math.max(0, overscan - firstVisible);
  const rows = lastVisible - first + 1 + overscan + clippedAbove;
  return {
    startLine: first,
    visibleLineCount: Math.max(1, Math.min(rows, Math.max(1, view.lineCount) - first)),
  };
}

function verticalLayout(
  layout: VerticalLayout | number,
  lineCount = Number.MAX_SAFE_INTEGER,
): VerticalLayout {
  return typeof layout === "number" ? new FixedLayout(lineCount, layout) : layout;
}

/** Where a caret sits, in pixels relative to the top-left of the scrolled content. */
export function caretPoint(
  { line, column, affinity }: Caret,
  layout: VerticalLayout | number,
  measure: LineMeasurer | PointMeasurer,
): { x: number; y: number } {
  const point =
    "columnToPoint" in measure
      ? measure.columnToPoint(line, column, affinity)
      : { x: measure.columnToX(line, column), y: 0 };
  return { x: point.x, y: verticalLayout(layout).top(line) + point.y };
}

/**
 * Resolve a click to a document position. The vertical layout determines the line. Measure
 * horizontal position to handle CJK, ligatures, and combining marks accurately.
 */
export function pointToCaret(
  x: number,
  y: number,
  layout: VerticalLayout | number,
  lineCount: number,
  measure: LineMeasurer | PointMeasurer,
): Caret {
  const line = Math.min(verticalLayout(layout, lineCount).lineAt(y), Math.max(0, lineCount - 1));
  if ("pointToColumn" in measure)
    return visualCaret(
      line,
      Math.max(0, x),
      Math.max(0, y - verticalLayout(layout).top(line)),
      measure,
    );
  const column = measure.xToColumn(line, Math.max(0, x));
  return { line, column };
}

export type SelectionRect = {
  top: number;
  left: number;
  /** Null means "to the end of the line", which is how a wrapped-through line is drawn. */
  width: number | null;
  height: number;
};

/**
 * Compute selection rectangles for the first-line tail, full middle lines, and last-line
 * head. Keep drawing independent of browser Selection state.
 */
export function selectionRects(
  start: Caret,
  end: Caret,
  layout: VerticalLayout | number,
  measure: LineMeasurer | PointMeasurer,
  lineLength: (line: number) => number,
  mountedLines?: readonly number[],
): SelectionRect[] {
  if (start.line === end.line && start.column === end.column) return [];

  const vertical = verticalLayout(layout);
  const rects: SelectionRect[] = [];
  const push = (line: number, fromColumn: number, toColumn: number | null): void => {
    if ("rangeRects" in measure) {
      rects.push(
        ...measure
          .rangeRects(line, fromColumn, toColumn)
          .map((rect) => ({ ...rect, top: vertical.top(line) + rect.top })),
      );
      return;
    }
    const left = measure.columnToX(line, fromColumn);
    rects.push({
      top: vertical.top(line),
      left,
      width: toColumn === null ? null : Math.max(0, measure.columnToX(line, toColumn) - left),
      height: vertical.height(line),
    });
  };

  if (mountedLines) {
    for (const line of mountedLines) {
      if (line < start.line || line > end.line) continue;
      push(line, line === start.line ? start.column : 0, line === end.line ? end.column : null);
    }
    return rects;
  }

  if (start.line === end.line) {
    push(start.line, start.column, end.column);
    return rects;
  }

  // Extend a selection through a newline to the panel edge so the highlight shows that the
  // newline is included.
  push(start.line, start.column, null);
  for (let line = start.line + 1; line < end.line; line++) push(line, 0, null);
  if (end.column > 0) push(end.line, 0, end.column);
  else if (lineLength(end.line) >= 0) push(end.line, 0, 0);

  return rects;
}

/** Legacy horizontal API retained for the imported geometry tests. */
export function domMeasurer(lineElement: (line: number) => HTMLElement | null): LineMeasurer {
  const measure = domLineMeasurer(lineElement);
  return {
    columnToX: (line, column) => measure.columnToPoint(line, column).x,
    xToColumn: (line, x) => measure.pointToColumn(line, x, 0),
  };
}
