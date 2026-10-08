import type { Caret } from "./document-store.svelte.js";
import type { LineMeasurer, VisualRow } from "./line-measurer.js";

export function rowAt(rows: VisualRow[], y: number): number {
  let index = 0;
  for (let row = 1; row < rows.length && rows[row].top <= y + 0.5; row++) index = row;
  return index;
}

/** A hit at the previous row's right edge keeps upstream affinity at the shared offset. */
export function visualCaret(line: number, x: number, y: number, measure: LineMeasurer): Caret {
  const column = measure.pointToColumn(line, x, y);
  const rows = measure.visualRows(line);
  const row = rows[rowAt(rows, y)];
  const downstream = measure.columnToPoint(line, column);
  const upstream = measure.columnToPoint(line, column, "upstream");
  return upstream.y < downstream.y && Math.abs(upstream.y - row.top) < 1
    ? { line, column, affinity: "upstream" }
    : { line, column };
}

export function moveVisualRow(
  caret: Caret,
  direction: -1 | 1,
  lineCount: number,
  measure: LineMeasurer,
  goalX?: number,
): { caret: Caret; goalX: number } {
  const point = measure.columnToPoint(caret.line, caret.column, caret.affinity);
  const x = goalX ?? point.x;
  let line = caret.line;
  let rows = measure.visualRows(line);
  let row = rowAt(rows, point.y) + direction;
  if (row < 0 || row >= rows.length) {
    const nextLine = line + direction;
    if (nextLine < 0 || nextLine >= lineCount) return { caret, goalX: x };
    line = nextLine;
    rows = measure.visualRows(line);
    row = direction < 0 ? rows.length - 1 : 0;
  }
  return { caret: visualCaret(line, x, rows[row].top, measure), goalX: x };
}

export function visualRowEdge(caret: Caret, edge: "start" | "end", measure: LineMeasurer): Caret {
  const point = measure.columnToPoint(caret.line, caret.column, caret.affinity);
  const rows = measure.visualRows(caret.line);
  return visualCaret(
    caret.line,
    edge === "start" ? 0 : Infinity,
    rows[rowAt(rows, point.y)].top,
    measure,
  );
}
