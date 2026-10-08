import { describe, expect, it } from "vitest";
import { history, position, scan, store, type ContentChangeEvent } from "@kozmof/reed";

/** Guard the Reed capabilities that determine Pararec's app-wide history strategy. */
describe("Reed 4 history integration", () => {
  it("transactions keep mixed actions as separate undo entries", () => {
    const doc = store.createDocumentStore({
      content: "abc",
      undoGroupTimeout: 300,
      reconcileMode: "none",
    });
    try {
      store.withTransaction(doc, () => {
        doc.dispatch({
          ...store.DocumentActions.insert(position.byteOffset(3), "!"),
          timestamp: 1000,
        });
        doc.dispatch({
          ...store.DocumentActions.delete(position.byteOffset(0), position.byteOffset(1)),
          timestamp: 1001,
        });
      });
      expect(scan.getValue(doc.getSnapshot().pieceTable)).toBe("bc!");
      expect(history.getUndoCount(doc.getSnapshot())).toBe(2);
      doc.dispatch(store.DocumentActions.undo());
      expect(scan.getValue(doc.getSnapshot().pieceTable)).toBe("abc!");
      doc.dispatch(store.DocumentActions.undo());
      expect(scan.getValue(doc.getSnapshot().pieceTable)).toBe("abc");
    } finally {
      doc.dispose();
    }
  });

  it("separate transactions do not isolate adjacent typing groups", () => {
    const doc = store.createDocumentStore({
      content: "",
      undoGroupTimeout: 300,
      reconcileMode: "none",
    });
    try {
      store.withTransaction(doc, () => {
        doc.dispatch({
          ...store.DocumentActions.insert(position.byteOffset(0), "a"),
          timestamp: 1000,
        });
      });
      store.withTransaction(doc, () => {
        doc.dispatch({
          ...store.DocumentActions.insert(position.byteOffset(1), "b"),
          timestamp: 1001,
        });
      });
      expect(history.getUndoCount(doc.getSnapshot())).toBe(1);
      doc.dispatch(store.DocumentActions.undo());
      expect(scan.getValue(doc.getSnapshot().pieceTable)).toBe("");
    } finally {
      doc.dispose();
    }
  });

  it("reports content byte ranges and emits a separate event for undo and redo", () => {
    const doc = store.createDocumentStoreWithEvents({ content: "", reconcileMode: "none" });
    const changes: ContentChangeEvent[] = [];
    const directions: string[] = [];
    doc.addEventListener("content-change", (event) => changes.push(event));
    doc.addEventListener("history-change", (event) => directions.push(event.direction));
    try {
      doc.dispatch(store.DocumentActions.insert(position.byteOffset(0), "日本"));
      expect(changes).toHaveLength(1);
      expect(changes[0].affectedRanges).toEqual([[0, 6]]);
      expect(history.getUndoCount(changes[0].prevState)).toBe(0);
      expect(history.getUndoCount(changes[0].nextState)).toBe(1);
      doc.dispatch(store.DocumentActions.undo());
      doc.dispatch(store.DocumentActions.redo());
      expect(changes).toHaveLength(1);
      expect(directions).toEqual(["undo", "redo"]);
    } finally {
      doc.dispose();
    }
  });

  it("a new edit after undo clears the Reed redo branch", () => {
    const doc = store.createDocumentStore({ content: "", reconcileMode: "none" });
    try {
      doc.dispatch(store.DocumentActions.insert(position.byteOffset(0), "first"));
      doc.dispatch(store.DocumentActions.undo());
      expect(history.canRedo(doc.getSnapshot())).toBe(true);
      doc.dispatch(store.DocumentActions.insert(position.byteOffset(0), "second"));
      expect(history.canRedo(doc.getSnapshot())).toBe(false);
      expect(scan.getValue(doc.getSnapshot().pieceTable)).toBe("second");
    } finally {
      doc.dispose();
    }
  });
});
