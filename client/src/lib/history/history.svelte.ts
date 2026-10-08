import type { Schema } from "../../schema.js";
import type { Caret } from "../editor/document-store.svelte.js";
export type FocusSnapshot = Caret & { contentId: string };
export type AppSnapshot = { schema: Schema; path: string[]; focus: FocusSnapshot | null };
export type HistoryEntry = { kind: "snapshot"; before: AppSnapshot; after: AppSnapshot };
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
  record(before: AppSnapshot, after: AppSnapshot, typing?: TypingGroup) {
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
    return copy(entry.before);
  }
  redo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#redo.at(-1);
    if (!entry) return null;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, entry].slice(-this.limit);
    return copy(entry.after);
  }
}
