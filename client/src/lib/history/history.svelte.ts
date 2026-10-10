import type { Schema } from "../../schema.js";
import type { Caret } from "../editor/document-store.svelte.js";
import { buildIndex } from "../tree/index.js";
import { applyOp } from "../tree/ops.js";
export type FocusSnapshot = Caret & { contentId: string };
/** UTF-16 offsets of the affected span in the before and after snapshots. */
export type TextChange = { contentId: string; from: number; oldEnd: number; newEnd: number };
export type TextPatch = { removed: string; inserted: string };
export type AppSnapshot = { schema: Schema; path: string[]; focus: FocusSnapshot | null; textChange?: TextChange };
type Navigation = Omit<AppSnapshot, "schema">;
export type HistoryEntry =
  | { kind: "snapshot"; before: AppSnapshot; after: AppSnapshot; textChange?: TextChange }
  | { kind: "text"; before: Navigation; after: Navigation; textChange: TextChange; removed: string; inserted: string };

function contentText(schema: Schema, id: string): string {
  const entry = buildIndex(schema).get(id);
  if (!entry || entry.side === "container") throw new Error("Unknown history content");
  return entry.side === "right" ? entry.container.right.text : entry.container.left[entry.index].text;
}
function navigation(snapshot: AppSnapshot): Navigation {
  return { path: [...snapshot.path], focus: snapshot.focus ? { ...snapshot.focus } : null };
}
// Copy substrings so a tiny patch cannot keep a huge sliced-string backing store alive.
function patchText(text: string): string {
  return JSON.parse(JSON.stringify(text)) as string;
}
function restore(entry: HistoryEntry, schema: Schema, undo: boolean): AppSnapshot {
  if (entry.kind === "snapshot") return copy(undo ? entry.before : entry.after);
  const change = entry.textChange;
  const text = contentText(schema, change.contentId);
  const end = undo ? change.newEnd : change.oldEnd;
  const replacement = undo ? entry.removed : entry.inserted;
  return {
    ...navigation({ schema, ...(undo ? entry.before : entry.after) }),
    schema: applyOp(schema, { type: "setText", id: change.contentId,
      text: text.slice(0, change.from) + replacement + text.slice(end), normalized: true }).schema,
  };
}
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
  #current: Schema | null = null;
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
    this.#current = null;
    this.closeGroup();
  }
  record(before: AppSnapshot, after: AppSnapshot, typing?: TypingGroup, textChange?: TextChange, patch?: TextPatch) {
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
      this.#current === before.schema &&
      last.after.path.length === before.path.length &&
      last.after.path.every((id, index) => id === before.path[index]) &&
      sameFocus(last.after.focus, before.focus);
    const combined = merge ? last!.textChange && textChange ? mergeChanges(last!.textChange, textChange) : undefined : textChange;
    let mergedPatch: TextPatch | undefined;
    if (merge && last!.kind === "text" && patch && textChange && combined) {
      const previous = last as Extract<HistoryEntry, { kind: "text" }>;
      const a = previous.textChange, b = textChange;
      if (b.from <= a.newEnd && b.oldEnd >= a.from) {
        const left = b.from < a.from ? patch.removed.slice(0, a.from - b.from) : "";
        const right = b.oldEnd > a.newEnd ? patch.removed.slice(a.newEnd - b.from) : "";
        const current = left + previous.inserted + right;
        mergedPatch = {
          removed: left + previous.removed + right,
          inserted: current.slice(0, b.from - combined.from) + patch.inserted + current.slice(b.oldEnd - combined.from),
        };
      }
    }
    const first = merge && !mergedPatch ? restore(last!, before.schema, true) : before;
    const savedPatch = mergedPatch ?? (!merge ? patch : undefined);
    const entry: HistoryEntry = combined ? {
      kind: "text",
      before: merge ? navigation({ schema: before.schema, ...last!.before }) : navigation(first),
      after: navigation(after),
      textChange: combined,
      removed: patchText(savedPatch?.removed ?? contentText(first.schema, combined.contentId).slice(combined.from, combined.oldEnd)),
      inserted: patchText(savedPatch?.inserted ?? contentText(after.schema, combined.contentId).slice(combined.from, combined.newEnd)),
    } : {
      kind: "snapshot",
      before: copy(first),
      after: copy(after),
      textChange: merge ? last!.textChange && textChange ? mergeChanges(last!.textChange, textChange) : undefined : textChange,
    };
    this.#undo = merge
      ? [...this.#undo.slice(0, -1), entry]
      : [...this.#undo, entry].slice(-this.limit);
    this.#redo = [];
    this.#current = after.schema;
    this.#group = typing ? { ...typing, time } : null;
  }
  undo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#undo.at(-1);
    if (!entry) return null;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, entry];
    const result = restore(entry, this.#current!, true);
    this.#current = result.schema;
    if (entry.textChange) result.textChange = { ...entry.textChange, oldEnd: entry.textChange.newEnd, newEnd: entry.textChange.oldEnd };
    return result;
  }
  redo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#redo.at(-1);
    if (!entry) return null;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, entry].slice(-this.limit);
    const result = restore(entry, this.#current!, false);
    this.#current = result.schema;
    if (entry.textChange) result.textChange = { ...entry.textChange };
    return result;
  }
}
