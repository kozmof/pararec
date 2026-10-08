import { position, query, rendering, scan } from "@kozmof/reed";
import type { ContentChangeEvent, DocumentState } from "@kozmof/reed";

/** End lines are exclusive, so layout can splice oldEndLine - fromLine heights. */
export type LineChange = {
  fromLine: number;
  oldEndLine: number;
  newEndLine: number;
  revision: number;
};

const lineAt = (state: DocumentState, byte: number) =>
  rendering.positionToLineColumn(
    state,
    position.byteOffset(Math.min(state.pieceTable.totalLength, Math.max(0, byte))),
  )?.line ?? 0;

/** Local edit ranges avoid comparing the unaffected document on every keystroke. */
export function contentLineChange(event: ContentChangeEvent): LineChange | null {
  const { action, prevState: before, nextState: after } = event;
  if (action.type === "APPLY_REMOTE") return compareLines(before, after);
  const start = action.start;
  const oldEnd = action.type === "INSERT" ? start : action.end;
  const newEnd = action.type === "DELETE" ? start : event.affectedRanges[0][1];
  return {
    fromLine: Math.min(lineAt(before, start), lineAt(after, start)),
    oldEndLine: Math.min(query.getLineCount(before), lineAt(before, oldEnd) + 1),
    newEndLine: Math.min(query.getLineCount(after), lineAt(after, newEnd) + 1),
    revision: after.revision,
  };
}

/** History and multi-edit transactions can affect several intermediate coordinate spaces. */
export function compareLines(before: DocumentState, after: DocumentState): LineChange | null {
  const oldLines = scan.getValue(before.pieceTable).split("\n");
  const newLines = scan.getValue(after.pieceTable).split("\n");
  let fromLine = 0;
  while (
    fromLine < oldLines.length &&
    fromLine < newLines.length &&
    oldLines[fromLine] === newLines[fromLine]
  )
    fromLine++;
  if (fromLine === oldLines.length && fromLine === newLines.length) return null;
  let oldEndLine = oldLines.length,
    newEndLine = newLines.length;
  while (
    oldEndLine > fromLine &&
    newEndLine > fromLine &&
    oldLines[oldEndLine - 1] === newLines[newEndLine - 1]
  ) {
    oldEndLine--;
    newEndLine--;
  }
  return { fromLine, oldEndLine, newEndLine, revision: after.revision };
}
