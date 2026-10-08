import { afterEach, describe, expect, it, vi } from "vitest";
import { scan } from "@kozmof/reed";
import { EditorDocument, type DocumentEdit } from "./document-store.svelte.js";

const opened: EditorDocument[] = [];
function document(text: string) {
  const doc = new EditorDocument(text);
  opened.push(doc);
  return doc;
}
afterEach(() => {
  for (const doc of opened.splice(0)) doc.dispose();
  vi.useRealTimers();
});

describe("grapheme carets", () => {
  it.each(["e\u0301", "👩‍👩‍👧‍👦", "👍🏽", "🇯🇵", "葛\u{E0100}"])(
    "moves and deletes %s as one cluster",
    (cluster) => {
      const doc = document(`a${cluster}b`);
      const end = 1 + cluster.length;
      expect(doc.columnAfter(0, 1)).toBe(end);
      expect(doc.columnBefore(0, end)).toBe(1);
      expect(doc.clamp({ line: 0, column: 2 })).toEqual({ line: 0, column: 1 });
      expect(doc.textBetween({ line: 0, column: 1 }, { line: 0, column: end })).toBe(cluster);
      doc.delete({ line: 0, column: doc.columnBefore(0, end) }, { line: 0, column: end });
      expect(doc.text()).toBe("ab");
      doc.undo();
      expect(doc.text()).toBe(`a${cluster}b`);
    },
  );

  it("refreshes cached boundaries when a line's text changes", () => {
    const doc = document("ab");
    expect(doc.columnAfter(0, 1)).toBe(2);
    doc.insert({ line: 0, column: 1 }, "👩‍🚀");
    expect(doc.columnAfter(0, 1)).toBe(6);
    doc.undo();
    expect(doc.columnAfter(0, 1)).toBe(2);
  });

  it("normalizes loaded and inserted line endings before resolving the caret", () => {
    const doc = document("a\r\nb\rc");
    expect(doc.text()).toBe("a\nb\nc");
    expect(doc.insert({ line: 0, column: 1 }, "\r\nx\r")).toEqual({ line: 2, column: 0 });
    expect(doc.text()).toBe("a\nx\n\nb\nc");
    doc.replace({ line: 0, column: 0 }, { line: 2, column: 0 }, "z\r\ny");
    expect(doc.text()).toBe("z\ny\nb\nc");
  });
});

describe("line changes", () => {
  it("tracks local byte ranges and history comparisons with exclusive end lines", () => {
    const doc = document("a\n日本😀\nz");
    expect(doc.lastChange).toBeNull();
    doc.insert({ line: 1, column: 2 }, "\nx\n");
    expect(doc.lastChange).toEqual({
      fromLine: 1,
      oldEndLine: 2,
      newEndLine: 4,
      revision: doc.state.revision,
    });
    doc.undo();
    expect(doc.lastChange).toEqual({
      fromLine: 1,
      oldEndLine: 4,
      newEndLine: 2,
      revision: doc.state.revision,
    });
    doc.redo();
    expect(doc.lastChange).toEqual({
      fromLine: 1,
      oldEndLine: 2,
      newEndLine: 4,
      revision: doc.state.revision,
    });
  });

  it("reports removed line spans and leaves a no-op unchanged", () => {
    const doc = document("a\nb\nc");
    doc.delete({ line: 0, column: 1 }, { line: 2, column: 0 });
    expect(doc.text()).toBe("ac");
    expect(doc.lastChange).toEqual({
      fromLine: 0,
      oldEndLine: 3,
      newEndLine: 1,
      revision: doc.state.revision,
    });
    const lastChange = doc.lastChange;
    doc.delete({ line: 0, column: 0 }, { line: 0, column: 0 });
    expect(doc.lastChange).toBe(lastChange);
  });

  it("unsubscribes edit observers and disposes safely twice", () => {
    const doc = document("a");
    const listener = vi.fn();
    const unsubscribe = doc.subscribeEdits(listener);
    doc.insert({ line: 0, column: 1 }, "b");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    doc.insert({ line: 0, column: 2 }, "c");
    expect(listener).toHaveBeenCalledOnce();
    doc.dispose();
    doc.dispose();
  });
});

describe("app transaction notifications", () => {
  it("defers new subscriptions to the next notification", () => {
    const doc = document("");
    const later = vi.fn();
    const unsubscribe = doc.subscribeEdits(() => {
      doc.subscribeEdits(later);
    });
    doc.insert({ line: 0, column: 0 }, "a");
    expect(later).not.toHaveBeenCalled();
    unsubscribe();
    doc.insert({ line: 0, column: 1 }, "b");
    expect(later).toHaveBeenCalledOnce();
  });

  it("reads staged edits but publishes only one before/after app action", () => {
    const doc = document("abc");
    const edits: DocumentEdit[] = [];
    doc.subscribeEdits((edit) => {
      expect(doc.state).toBe(edit.after);
      edits.push(edit);
    });
    doc.transact((current) => {
      const at = current.insert({ line: 0, column: 3 }, "\n日本");
      expect(at).toEqual({ line: 1, column: 2 });
      expect(current.lineText(1)).toBe("日本");
      current.delete({ line: 0, column: 0 }, { line: 0, column: 1 });
      expect(edits).toHaveLength(0);
      expect(doc.lastChange).toBeNull();
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].kind).toBe("transaction");
    expect(scan.getValue(edits[0].before.pieceTable)).toBe("abc");
    expect(scan.getValue(edits[0].after.pieceTable)).toBe("bc\n日本");
    expect(doc.lastChange).toEqual({
      fromLine: 0,
      oldEndLine: 1,
      newEndLine: 2,
      revision: doc.state.revision,
    });
    // P11 records this notification as one tree snapshot action. Native Reed retains both edits.
  });

  it("rolls back text, history, and notifications on failure", () => {
    const doc = document("abc");
    const before = doc.state;
    const listener = vi.fn();
    doc.subscribeEdits(listener);
    expect(() =>
      doc.transact((current) => {
        current.insert({ line: 0, column: 3 }, "!");
        throw new Error("failed");
      }),
    ).toThrow("failed");
    expect(doc.state).toBe(before);
    expect(doc.text()).toBe("abc");
    expect(doc.canUndo).toBe(false);
    expect(doc.lastChange).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps outer edits when a nested transaction rolls back", () => {
    const doc = document("");
    const listener = vi.fn();
    doc.subscribeEdits(listener);
    doc.transact((current) => {
      current.insert({ line: 0, column: 0 }, "a");
      expect(() =>
        current.transact((inner) => {
          inner.insert({ line: 0, column: 1 }, "bad");
          throw new Error("nested");
        }),
      ).toThrow("nested");
      current.insert({ line: 0, column: 1 }, "b");
    });
    expect(doc.text()).toBe("ab");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("publishes nothing for a transaction with no net text change", () => {
    const doc = document("a");
    const listener = vi.fn();
    doc.subscribeEdits(listener);
    doc.transact((current) => {
      current.insert({ line: 0, column: 1 }, "b");
      current.delete({ line: 0, column: 1 }, { line: 0, column: 2 });
    });
    expect(doc.text()).toBe("a");
    expect(listener).not.toHaveBeenCalled();
    expect(doc.lastChange).toBeNull();
  });

  it("rejects async callbacks before invocation and rolls back returned promises", () => {
    const doc = document("a");
    const invoked = vi.fn();
    expect(() =>
      doc.transact(async () => {
        invoked();
      }),
    ).toThrow("synchronous");
    expect(invoked).not.toHaveBeenCalled();
    expect(() =>
      doc.transact((current) => {
        current.insert({ line: 0, column: 1 }, "b");
        return Promise.resolve();
      }),
    ).toThrow("synchronous");
    expect(doc.text()).toBe("a");
  });

  it("ends native and app typing groups without clearing earlier history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const doc = document("");
    const groups: number[] = [];
    doc.subscribeEdits((edit) => groups.push(edit.group));
    doc.insert({ line: 0, column: 0 }, "a");
    doc.closeHistoryGroup();
    doc.insert({ line: 0, column: 1 }, "b");
    doc.insert({ line: 0, column: 2 }, "c");
    expect(groups[0]).not.toBe(groups[1]);
    expect(groups[1]).toBe(groups[2]);
    doc.undo();
    expect(doc.text()).toBe("a");
    doc.undo();
    expect(doc.text()).toBe("");
  });
});

it("publishes exact caret metadata for ambiguous repeated text and UTF-8 insertion", () => {
  const doc = document("aaaa"),
    edits: DocumentEdit[] = [];
  doc.subscribeEdits((edit) => edits.push(edit));
  doc.insert({ line: 0, column: 0 }, "a");
  expect(edits[0]).toMatchObject({
    beforeCaret: { line: 0, column: 0 },
    afterCaret: { line: 0, column: 1 },
    intent: "insert",
    groupable: true,
  });
  doc.insert({ line: 0, column: 1 }, "日本\n👩‍🚀");
  expect(edits[1]).toMatchObject({
    beforeCaret: { line: 0, column: 1 },
    afterCaret: { line: 1, column: 5 },
    groupable: false,
  });
});
it("publishes the first and last caret of a compound transaction once", () => {
  const doc = document("abc"),
    edits: DocumentEdit[] = [];
  doc.subscribeEdits((edit) => edits.push(edit));
  doc.transact(() => {
    doc.insert({ line: 0, column: 1 }, "日本");
    doc.delete({ line: 0, column: 3 }, { line: 0, column: 4 }, { line: 0, column: 4 });
  });
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({
    kind: "transaction",
    beforeCaret: { line: 0, column: 1 },
    afterCaret: { line: 0, column: 3 },
  });
});
