import type { Schema } from "../../schema.js";
import type { Caret } from "../editor/document-store.svelte.js";
export type FocusSnapshot = Caret & { contentId: string };
/** UTF-16 offsets of the affected span in the before and after snapshots. */
export type TextChange = { contentId: string; from: number; oldEnd: number; newEnd: number };
export type AppSnapshot = { schema: Schema; path: string[]; focus: FocusSnapshot | null; textChange?: TextChange };
export type HistoryEntry = { kind: "snapshot"; before: AppSnapshot; after: AppSnapshot; textChange?: TextChange };
function mergeChanges(a: TextChange, b: TextChange): TextChange {
  const oldDelta = a.newEnd - a.oldEnd;
  const newDelta = b.newEnd - b.oldEnd;
  return {
    contentId: a.contentId,
    from: Math.min(a.from, b.from >= a.newEnd ? b.from - oldDelta : b.from),
    oldEnd: Math.max(a.oldEnd, b.oldEnd >= a.newEnd ? b.oldEnd - oldDelta : a.oldEnd),
    newEnd: Math.max(b.newEnd, a.newEnd >= b.oldEnd ? a.newEnd + newDelta : b.newEnd),
  };
}
export type TypingGroup = {
  contentId: string;
  intent: "insert" | "backspace" | "delete";
  group: number;
  time?: number;
};
function copy(snapshot: AppSnapshot): AppSnapshot {
  return {
    schema: snapshot.schema,
    path: [...snapshot.path],
    focus: snapshot.focus ? { ...snapshot.focus } : null,
  };
}
function sameFocus(a: FocusSnapshot | null, b: FocusSnapshot | null): boolean {
  return (
    !!a &&
    !!b &&
    a.contentId === b.contentId &&
    a.line === b.line &&
    a.column === b.column &&
    a.affinity === b.affinity
  );
}

export class AppHistory {
  #undo = $state.raw<HistoryEntry[]>([]);
  #redo = $state.raw<HistoryEntry[]>([]);
  #group: (TypingGroup & { time: number }) | null = null;
  constructor(private limit = 500) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("History limit must be positive");
  }
  get canUndo() {
    return this.#undo.length > 0;
  }
  get canRedo() {
    return this.#redo.length > 0;
  }
  get undoCount() {
    return this.#undo.length;
  }
  get redoCount() {
    return this.#redo.length;
  }
  closeGroup() {
    this.#group = null;
  }
  clear() {
    this.#undo = [];
    this.#redo = [];
    this.closeGroup();
  }
  record(before: AppSnapshot, after: AppSnapshot, typing?: TypingGroup, textChange?: TextChange) {
    if (before.schema === after.schema) return;
    const time = typing?.time ?? Date.now();
    const last = this.#undo.at(-1),
      group = this.#group;
    const merge =
      !!typing &&
      !!group &&
      !!last &&
      typing.contentId === group.contentId &&
      typing.intent === group.intent &&
      typing.group === group.group &&
      time >= group.time &&
      time - group.time <= 300 &&
      last.after.schema === before.schema &&
      last.after.path.length === before.path.length &&
      last.after.path.every((id, index) => id === before.path[index]) &&
      sameFocus(last.after.focus, before.focus);
    const entry: HistoryEntry = {
      kind: "snapshot",
      before: merge ? last!.before : copy(before),
      after: copy(after),
      textChange: merge ? last!.textChange && textChange ? mergeChanges(last!.textChange, textChange) : undefined : textChange,
    };
    this.#undo = merge
      ? [...this.#undo.slice(0, -1), entry]
      : [...this.#undo, entry].slice(-this.limit);
    this.#redo = [];
    this.#group = typing ? { ...typing, time } : null;
  }
  undo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#undo.at(-1);
    if (!entry) return null;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, entry];
    const result = copy(entry.before);
    if (entry.textChange) result.textChange = { ...entry.textChange, oldEnd: entry.textChange.newEnd, newEnd: entry.textChange.oldEnd };
    return result;
  }
  redo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#redo.at(-1);
    if (!entry) return null;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, entry].slice(-this.limit);
    const result = copy(entry.after);
    if (entry.textChange) result.textChange = { ...entry.textChange };
    return result;
  }
}
