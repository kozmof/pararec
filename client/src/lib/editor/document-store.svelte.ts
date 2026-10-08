import { history, position, query, rendering, scan, store } from "@kozmof/reed";
import { GraphemeCache, normalizeLineBreaks } from "./graphemes.js";
import { compareLines, contentLineChange, type LineChange } from "./document-change.js";
import type { CaretAffinity } from "./line-measurer.js";
import type { SelectionRange, DocumentAction as ReedAction } from "@kozmof/reed";

type DocumentState = ReturnType<ReturnType<typeof store.createDocumentStore>["getSnapshot"]>;
type ReedStore = ReturnType<typeof store.createDocumentStoreWithEvents>;
export type { LineChange } from "./document-change.js";

/** Consume these immediately to record tree snapshots without retaining Reed stores. */
export type DocumentEdit = {
  before: DocumentState;
  after: DocumentState;
  change: LineChange;
  kind: "edit" | "transaction" | "composition" | "undo" | "redo";
  group: number;
};

/** A caret or a selection end, in the coordinates the render layer draws in. */
export type Caret = {
  /** 0-indexed line. */
  line: number;
  /** 0-indexed column, counted in characters rather than bytes. */
  column: number;
  /** The visual side of an offset shared by two wrapped rows. */
  affinity?: CaretAffinity;
};

export type VisibleLine = {
  lineNumber: number;
  content: string;
};

/**
 * Time window for grouping consecutive compatible edits into one undo entry. A longer pause,
 * a different edit kind, or a different location starts a new entry.
 */
const UNDO_GROUP_MS = 300;

/** Ordered so `start` is never after `end`, whichever way the selection was made. */
export function orderCarets(a: Caret, b: Caret): { start: Caret; end: Caret } {
  const aFirst = a.line < b.line || (a.line === b.line && a.column <= b.column);
  return aFirst ? { start: a, end: b } : { start: b, end: a };
}

export function sameCaret(a: Caret, b: Caret): boolean {
  return a.line === b.line && a.column === b.column;
}

/**
 * Bridge one Reed document store to Svelte runes. Refresh a `$state.raw` snapshot from the
 * store subscription so immutable Reed state keeps its reference identity.
 *
 * The editor uses line and column coordinates. Columns count UTF-16 code units, while Reed
 * positions are UTF-8 byte offsets. Convert between them here and use Reed's types directly.
 *
 * Keep carets on grapheme boundaries. Combining marks, variation selectors, and emoji
 * sequences move and delete together. Clicks inside a cluster snap to its start.
 */
export class EditorDocument {
  #store: ReedStore;
  #unsubscribe: (() => void) | null = null;
  #eventUnsubscribers: (() => void)[] = [];
  #graphemes = new GraphemeCache();
  #transactionDepth = 0;
  #group = 0;
  #clockOffset = 0;
  #editListeners = new Set<(edit: DocumentEdit) => void>();
  lastChange = $state.raw<LineChange | null>(null);

  /**
   * Immutable Reed snapshot, temporarily undefined during construction. Initialize it before
   * returning the instance and expose it through the checked `state` getter. Keep it raw to
   * preserve reference identity.
   */
  #current = $state.raw<DocumentState | undefined>(undefined);

  /**
   * Current Reed state, replaced on every edit. Throw if initialization order leaves it
   * unavailable so failures identify the missing snapshot directly.
   */
  get state(): DocumentState {
    const current = this.#transactionDepth ? this.#store.getSnapshot() : this.#current;
    if (current === undefined) throw new Error("EditorDocument read before its first snapshot");
    return current;
  }

  /** Content last read or saved, so returning to it through undo or redo is clean. */
  #savedContent = $state("");

  /** Cache the comparison until the document or saved content changes. */
  #dirty = $derived(this.text() !== this.#savedContent);

  constructor(content: string) {
    this.#store = store.createDocumentStoreWithEvents({
      content: normalizeLineBreaks(content),
      undoGroupTimeout: UNDO_GROUP_MS,
    });
    this.#current = this.#store.getSnapshot();
    this.#savedContent = this.text();
    this.#eventUnsubscribers = [
      this.#store.addEventListener("content-change", (event) => {
        if (this.#transactionDepth) return;
        const change = contentLineChange(event);
        if (change) this.#publish(event.prevState, event.nextState, change, "edit");
      }),
      this.#store.addEventListener("history-change", (event) => {
        if (this.#transactionDepth) return;
        const change = compareLines(event.prevState, event.nextState);
        if (change) this.#publish(event.prevState, event.nextState, change, event.direction);
      }),
    ];
    this.#unsubscribe = this.#store.subscribe(() => {
      this.#current = this.#store.getSnapshot();
    });
  }

  /**
   * Drops the subscription. The store holds a reconciliation scheduler that keeps running
   * otherwise, so an editor closed without this leaves work behind for a file nobody has
   * open.
   */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const unsubscribe of this.#eventUnsubscribers) unsubscribe();
    this.#eventUnsubscribers = [];
    this.#editListeners.clear();
    this.#graphemes.clear();
    this.#store.dispose();
  }

  #publish(
    before: DocumentState,
    after: DocumentState,
    change: LineChange,
    kind: DocumentEdit["kind"],
  ): void {
    this.lastChange = change;
    const edit: DocumentEdit = { before, after, change, kind, group: this.#group };
    // Subscription changes during delivery apply to the next notification.
    const listeners = Array.from(this.#editListeners);
    for (const listener of listeners) listener(edit);
  }

  /** One notification per edit or outer transaction for the app snapshot history. */
  subscribeEdits(listener: (edit: DocumentEdit) => void): () => void {
    this.#editListeners.add(listener);
    return () => {
      this.#editListeners.delete(listener);
    };
  }

  /** Call on blur and before structural actions. Native history keeps earlier entries. */
  closeHistoryGroup(): void {
    this.#group++;
    // Reed has no explicit group delimiter. Advance only its grouping clock beyond the
    // timeout, retaining real time differences within each subsequent typing group.
    this.#clockOffset += UNDO_GROUP_MS + 1;
  }

  #dispatch(action: Extract<ReedAction, { type: "INSERT" | "DELETE" | "REPLACE" }>): void {
    this.#store.dispatch({ ...action, timestamp: Date.now() + this.#clockOffset });
  }

  /** Batch publication and emit one app action. Reed's native undo entries stay separate. */
  transact(
    fn: (doc: EditorDocument) => void,
    kind: "transaction" | "composition" = "transaction",
  ): void {
    if (Object.prototype.toString.call(fn) === "[object AsyncFunction]")
      throw new TypeError("EditorDocument.transact requires a synchronous callback");
    const before = this.state;
    const outer = this.#transactionDepth === 0;
    if (outer) this.closeHistoryGroup();
    this.#transactionDepth++;
    let committed = false;
    try {
      store.withTransaction(this.#store, () => fn(this));
      committed = true;
    } finally {
      this.#transactionDepth--;
      if (outer) {
        this.#current = this.#store.getSnapshot();
        const after = this.state;
        try {
          if (committed) {
            const change = compareLines(before, after);
            if (change) this.#publish(before, after, change, kind);
          }
        } finally {
          this.closeHistoryGroup();
        }
      }
    }
  }

  get lineCount(): number {
    return query.getLineCount(this.state);
  }

  get canUndo(): boolean {
    return history.canUndo(this.state);
  }

  get canRedo(): boolean {
    return history.canRedo(this.state);
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  /** Marks the current content as what is on disk. Called after a save. */
  markSaved(): void {
    this.#savedContent = this.text();
  }

  /**
   * Return only viewport lines so rendered DOM size follows panel height rather than document
   * length.
   */
  visibleLines(startLine: number, visibleLineCount: number, overscan = 4): VisibleLine[] {
    const result = rendering.getVisibleLines(this.state, {
      startLine: Math.max(0, startLine),
      visibleLineCount,
      overscan,
    });
    // Narrowed to the two fields the panel draws. Reed's own `VisibleLine` also carries
    // byte offsets and a newline flag, which are its coordinates rather than this one's.
    return result.lines.map(({ lineNumber, content }) => ({ lineNumber, content }));
  }

  /** One line's text, or `""` for a line that is out of range. */
  lineText(line: number): string {
    return rendering.getLineContent(this.state, line) ?? "";
  }

  /** Read the whole document in O(n) time for saving, outside the rendering path. */
  text(): string {
    return scan.getValue(this.state.pieceTable);
  }

  /**
   * Clamp the caret to its line and snap backward to a grapheme boundary.
   */
  clamp({ line, column, affinity }: Caret): Caret {
    const lastLine = Math.max(0, this.lineCount - 1);
    const safeLine = Math.min(Math.max(0, line), lastLine);
    return {
      line: safeLine,
      column: this.#graphemes.snap(safeLine, this.lineText(safeLine), column),
      ...(affinity ? { affinity } : {}),
    };
  }

  /** Step backward by one whole grapheme for movement and backspace. */
  columnBefore(line: number, column: number): number {
    const text = this.lineText(line);
    const index = this.#graphemes.index(line, text, column);
    return this.#graphemes.boundaries(line, text)[Math.max(0, index - 1)];
  }

  /** Step forward by one whole grapheme, paired with columnBefore. */
  columnAfter(line: number, column: number): number {
    const text = this.lineText(line);
    const boundaries = this.#graphemes.boundaries(line, text);
    const index = this.#graphemes.index(line, text, column);
    return boundaries[Math.min(boundaries.length - 1, index + 1)];
  }

  #byteOffset({ line, column }: Caret): number {
    // Resolve byte offsets only at whole grapheme boundaries.
    const offset = rendering.lineColumnToPosition(
      this.state,
      line,
      this.#graphemes.snap(line, this.lineText(line), column),
    );
    // Clamp unresolved carets beyond the document to its end.
    return offset ?? this.state.pieceTable.totalLength;
  }

  #caretAt(byteOffset: number): Caret {
    // Use the branded byte-offset constructor so Reed's offset type remains checked.
    const at = rendering.positionToLineColumn(this.state, position.byteOffset(byteOffset));
    return at ? this.clamp(at) : { line: 0, column: 0 };
  }

  /**
   * Record the pre-edit selection on the action so undo restores the caret near the text it
   * changes.
   */
  #selectionAt(byteOffset: number): [SelectionRange] {
    const at = position.byteOffset(byteOffset);
    // Use a tuple to satisfy Reed's non-empty selection requirement.
    return [{ anchor: at, head: at }];
  }

  /** Inserts `text` at `at`, and answers where the caret ends up. */
  insert(at: Caret, text: string): Caret {
    text = normalizeLineBreaks(text);
    const start = this.#byteOffset(at);
    this.#dispatch(
      store.DocumentActions.insert(position.byteOffset(start), text, this.#selectionAt(start)),
    );
    return this.#caretAt(start + byteLength(text));
  }

  /**
   * Delete `start` through `end` and return the resulting caret position. Record
   * `caretBefore` for undo. It defaults to `start`, but backspace must pass the caret at
   * `end`.
   */
  delete(start: Caret, end: Caret, caretBefore: Caret = start): Caret {
    const from = this.#byteOffset(start);
    const to = this.#byteOffset(end);
    if (from === to) return start;
    this.#dispatch(
      store.DocumentActions.delete(
        position.byteOffset(from),
        position.byteOffset(to),
        this.#selectionAt(this.#byteOffset(caretBefore)),
      ),
    );
    return this.#caretAt(from);
  }

  /**
   * Replaces `start`–`end` with `text` in one entry, so one undo takes it all back.
   * `caretBefore` carries the same meaning as on {@link delete}.
   */
  replace(start: Caret, end: Caret, text: string, caretBefore: Caret = start): Caret {
    text = normalizeLineBreaks(text);
    const from = this.#byteOffset(start);
    const to = this.#byteOffset(end);
    this.#dispatch(
      store.DocumentActions.replace(
        position.byteOffset(from),
        position.byteOffset(to),
        text,
        this.#selectionAt(this.#byteOffset(caretBefore)),
      ),
    );
    return this.#caretAt(from + byteLength(text));
  }

  /**
   * Read text between two carets in O(n) document time. Use Reed's line offsets to account
   * for actual line endings, then add snapped UTF-16 columns before slicing.
   */
  textBetween(start: Caret, end: Caret): string {
    const whole = this.text();
    // One encode for both ends. A line start always falls on a character boundary, whatever
    // the line ending is, so decoding the prefix up to one is lossless.
    const bytes = new TextEncoder().encode(whole);
    const charOffset = ({ line, column }: Caret): number => {
      const lineStart = this.#byteOffset({ line, column: 0 });
      const at = this.#graphemes.snap(line, this.lineText(line), column);
      return new TextDecoder().decode(bytes.subarray(0, lineStart)).length + at;
    };
    return whole.slice(charOffset(start), charOffset(end));
  }

  /** The caret this document's own selection points at, or null when it has none. */
  selectionCaret(): Caret | null {
    const head = query.getSelectionHead(this.state);
    return head == null ? null : this.#caretAt(head);
  }

  /** Undo one edit and return its recorded caret position, or null when nothing can be undone. */
  undo(): Caret | null {
    this.closeHistoryGroup();
    if (!this.canUndo) return null;
    this.#store.dispatch(store.DocumentActions.undo());
    return this.selectionCaret();
  }

  /** Redo one edit and return its caret position, paired with {@link undo}. */
  redo(): Caret | null {
    this.closeHistoryGroup();
    if (!this.canRedo) return null;
    this.#store.dispatch(store.DocumentActions.redo());
    return this.selectionCaret();
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
