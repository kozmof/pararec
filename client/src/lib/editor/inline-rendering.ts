import type { Caret } from "./document-store.svelte.js";

/** Source coordinates stay independent of presentation and interactive annotations. */
export type InlineDecoration = {
  id: string;
  start: Caret;
  end: Caret;
  kind: "link";
  destinations: readonly { id: string; label: string }[];
};
export type InlineRun = {
  from: number;
  to: number;
  decorations: readonly InlineDecoration[];
  endings: readonly InlineDecoration[];
};

/** Split only at decoration boundaries; overlapping and multiline ranges retain source offsets. */
export function inlineRuns(text: string, line: number, decorations: readonly InlineDecoration[]): InlineRun[] {
  const ranges = decorations.flatMap(decoration => {
    if (line < decoration.start.line || line > decoration.end.line) return [];
    const from = Math.max(0, Math.min(text.length, line === decoration.start.line ? decoration.start.column : 0));
    const to = Math.max(from, Math.min(text.length, line === decoration.end.line ? decoration.end.column : text.length));
    return to > from ? [{ from, to, decoration }] : [];
  });
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.from, range.to])])].sort((a, b) => a - b);
  const initialEndings = decorations.filter(item => item.start.line < line && item.end.line === line && item.end.column === 0);
  const initial: InlineRun[] = initialEndings.length ? [{ from: 0, to: 0, decorations: [], endings: initialEndings }] : [];
  if (!text.length) return initial.length ? initial : [{ from: 0, to: 0, decorations: [], endings: [] }];
  return initial.concat(boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1];
    return {
      from, to,
      decorations: ranges.filter(range => range.from <= from && range.to >= to).map(range => range.decoration),
      endings: ranges.filter(range => range.to === to && range.decoration.end.line === line).map(range => range.decoration),
    };
  }));
}
