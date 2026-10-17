import type { Schema } from "../../schema.js";
import type { Caret } from "../editor/document-store.svelte.js";
import { buildIndex, updateIndex, type TreeIndex } from "../tree/index.js";
import { applyOp } from "../tree/ops.js";
import { applySchemaChanges, schemaChanges, type SchemaChange } from "./schema-change.js";
export type FocusSnapshot = Caret & { contentId: string };
/** UTF-16 offsets of the affected span in the before and after snapshots. */
export type TextChange = { contentId: string; from: number; oldEnd: number; newEnd: number };
export type TextPatch = { removed: string; inserted: string };
export type AppSnapshot = {
  schema: Schema;
  path: string[];
  focus: FocusSnapshot | null;
  textChange?: TextChange;
};
type Navigation = Omit<AppSnapshot, "schema">;
export type HistoryEntry =
  | {
      kind: "structure";
      before: Navigation;
      after: Navigation;
      changes: SchemaChange[];
      textChange?: TextChange;
    }
  | {
      kind: "text";
      before: Navigation;
      after: Navigation;
      textChange: TextChange;
      removed: string;
      inserted: string;
      beforeLinks: Schema["links"];
      afterLinks: Schema["links"];
    };

function contentText(schema: Schema, id: string, index: TreeIndex = buildIndex(schema)): string {
  const entry = index.get(id);
  if (!entry || entry.side === "container") throw new Error("Unknown history content");
  return entry.side === "right"
    ? entry.container.right.text
    : entry.container.left[entry.index].text;
}
function navigation(snapshot: AppSnapshot): Navigation {
  return { path: [...snapshot.path], focus: snapshot.focus ? { ...snapshot.focus } : null };
}
// Copy substrings so a tiny patch cannot keep a huge sliced-string backing store alive.
function patchText(text: string): string {
  return JSON.parse(JSON.stringify(text)) as string;
}
function restore(
  entry: HistoryEntry,
  schema: Schema,
  undo: boolean,
  currentIndex?: TreeIndex,
): AppSnapshot {
  if (entry.kind === "structure")
    return {
      ...navigation({ schema, ...(undo ? entry.before : entry.after) }),
      schema: applySchemaChanges(schema, entry.changes, undo),
    };
  const change = entry.textChange;
  const index = currentIndex ?? buildIndex(schema);
  const text = contentText(schema, change.contentId, index);
  const end = undo ? change.newEnd : change.oldEnd;
  const replacement = undo ? entry.removed : entry.inserted;
  return {
    ...navigation({ schema, ...(undo ? entry.before : entry.after) }),
    schema: {
      ...applyOp(
        schema,
        {
          type: "setText",
          id: change.contentId,
          text: text.slice(0, change.from) + replacement + text.slice(end),
          normalized: true,
        },
        index,
      ).schema,
      links: undo ? entry.beforeLinks : entry.afterLinks,
    },
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
  #sizes = new WeakMap<object, number>();
  #index: ReturnType<typeof buildIndex> | null = null;
  #setCurrent(schema: Schema) {
    if (this.#index && this.#current) updateIndex(this.#index, this.#current.root, schema.root);
    this.#current = schema;
  }
  // Estimate retained data without allocating a serialized copy of a potentially huge action.
  // History values are immutable; shared subtrees only need to be measured once.
  #size(value: unknown): number {
    if (typeof value === "string") return value.length * 2;
    if (value === null || typeof value !== "object") return 8;
    const cached = this.#sizes.get(value);
    if (cached !== undefined) return cached;
    let size = 16;
    if (Array.isArray(value)) {
      for (const child of value) size += 8 + this.#size(child);
    } else {
      for (const [key, child] of Object.entries(value))
        size += key.length * 2 + 8 + this.#size(child);
    }
    this.#sizes.set(value, size);
    return size;
  }
  constructor(
    private limit = 500,
    private byteLimit = 16 * 1024 * 1024,
  ) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("History limit must be positive");
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1)
      throw new RangeError("History byte limit must be positive");
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
    this.#index = null;
    this.#sizes = new WeakMap();
    this.closeGroup();
  }
  record(
    before: AppSnapshot,
    after: AppSnapshot,
    typing?: TypingGroup,
    textChange?: TextChange,
    patch?: TextPatch,
  ) {
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
    const combined = merge
      ? last!.textChange && textChange
        ? mergeChanges(last!.textChange, textChange)
        : undefined
      : textChange;
    let mergedPatch: TextPatch | undefined;
    if (merge && last!.kind === "text" && patch && textChange && combined) {
      const previous = last as Extract<HistoryEntry, { kind: "text" }>;
      const a = previous.textChange,
        b = textChange;
      if (b.from <= a.newEnd && b.oldEnd >= a.from) {
        const left = b.from < a.from ? patch.removed.slice(0, a.from - b.from) : "";
        const right = b.oldEnd > a.newEnd ? patch.removed.slice(a.newEnd - b.from) : "";
        const current = left + previous.inserted + right;
        mergedPatch = {
          removed: left + previous.removed + right,
          inserted:
            current.slice(0, b.from - combined.from) +
            patch.inserted +
            current.slice(b.oldEnd - combined.from),
        };
      }
    }
    const first =
      merge && !mergedPatch
        ? restore(last!, before.schema, true, this.#index ?? undefined)
        : before;
    const savedPatch = mergedPatch ?? (!merge ? patch : undefined);
    const entry: HistoryEntry = combined
      ? {
          kind: "text",
          beforeLinks: merge
            ? last!.kind === "text"
              ? last!.beforeLinks
              : first.schema.links
            : before.schema.links,
          afterLinks: after.schema.links,
          before: merge
            ? navigation({ schema: before.schema, ...last!.before })
            : navigation(first),
          after: navigation(after),
          textChange: combined,
          removed: patchText(
            savedPatch?.removed ??
              contentText(first.schema, combined.contentId).slice(combined.from, combined.oldEnd),
          ),
          inserted: patchText(
            savedPatch?.inserted ??
              contentText(after.schema, combined.contentId).slice(combined.from, combined.newEnd),
          ),
        }
      : {
          kind: "structure",
          before: navigation(first),
          after: navigation(after),
          changes: schemaChanges(first.schema, after.schema),
          textChange: merge
            ? last!.textChange && textChange
              ? mergeChanges(last!.textChange, textChange)
              : undefined
            : textChange,
        };
    this.#undo = merge
      ? [...this.#undo.slice(0, -1), entry]
      : [...this.#undo, entry].slice(-this.limit);
    this.#redo = [];
    // Bound retained changes; keep the latest action undoable even if it exceeds the budget.
    this.#size(entry);
    let bytes = 0;
    let keep = this.#undo.length;
    for (let i = this.#undo.length - 1; i >= 0; i--) {
      bytes += this.#sizes.get(this.#undo[i])!;
      if (bytes > this.byteLimit && i < this.#undo.length - 1) break;
      keep = i;
    }
    this.#undo = this.#undo.slice(keep);
    this.#setCurrent(after.schema);
    this.#group = typing ? { ...typing, time } : null;
  }
  undo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#undo.at(-1);
    if (!entry) return null;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, entry];
    this.#index ??= buildIndex(this.#current!);
    const result = restore(entry, this.#current!, true, this.#index);
    this.#setCurrent(result.schema);
    if (entry.textChange)
      result.textChange = {
        ...entry.textChange,
        oldEnd: entry.textChange.newEnd,
        newEnd: entry.textChange.oldEnd,
      };
    return result;
  }
  redo(): AppSnapshot | null {
    this.closeGroup();
    const entry = this.#redo.at(-1);
    if (!entry) return null;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, entry].slice(-this.limit);
    this.#index ??= buildIndex(this.#current!);
    const result = restore(entry, this.#current!, false, this.#index);
    this.#setCurrent(result.schema);
    if (entry.textChange) result.textChange = { ...entry.textChange };
    return result;
  }
}
