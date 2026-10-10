import { afterEach, expect, it, vi } from "vitest";
import { TreeStore } from "../tree/tree-store.svelte.js";
import { ContentCache } from "./content-cache.js";
import { EditorDocument } from "./document-store.svelte.js";
import { AppHistory } from "../history/history.svelte.js";
let cache: ContentCache;
afterEach(() => {
  cache?.dispose();
  vi.restoreAllMocks();
});
const tree = () =>
  new TreeStore({
    version: 1,
    root: [
      {
        id: "a",
        left: [
          { id: "l", text: "left" },
          { id: "l2", text: "second" },
        ],
        right: { id: "r", text: "right", children: [] },
      },
    ],
  });
it("reuses a store and publishes edits to the authoritative tree synchronously", () => {
  const store = tree(),
    changed = vi.fn();
  cache = new ContentCache(store, changed);
  const doc = cache.get("l");
  expect(cache.get("l")).toBe(doc);
  doc.insert({ line: 0, column: 0 }, "日本");
  expect(store.schema.root[0].left[0].text).toBe("日本left");
  expect(changed).toHaveBeenCalledOnce();
});

it("restores a history range in the same document without publishing another history edit", () => {
  const store = tree(), changed = vi.fn();
  cache = new ContentCache(store, changed);
  const doc = cache.get("r");
  const before = store.schema;
  doc.insert({ line: 0, column: 0 }, "日本");
  const after = store.schema;
  const range = changed.mock.calls[0][0].textChange;
  store.restore(before);
  expect(cache.restoreText({ ...range, oldEnd: range.newEnd, newEnd: range.oldEnd }, "日本right")).toBe(true);
  expect(cache.get("r")).toBe(doc);
  expect(doc.text()).toBe("right");
  store.restore(after);
  expect(cache.restoreText(range, "right")).toBe(true);
  expect(cache.get("r")).toBe(doc);
  expect(doc.text()).toBe("日本right");
  expect(changed).toHaveBeenCalledOnce();
});

it("falls back to rebuilding a stale cached document instead of applying a history range", () => {
  const store = tree();
  cache = new ContentCache(store, () => {});
  const stale = cache.get("r");
  store.apply({ type: "setText", id: "r", text: "external" });
  expect(cache.restoreText({ contentId: "r", from: 0, oldEnd: 5, newEnd: 8 }, "another snapshot")).toBe(false);
  expect(cache.get("r")).not.toBe(stale);
  expect(cache.get("r").text()).toBe("external");
});

it("restores a transaction that only removes the final newline", () => {
  const store = tree(), changed = vi.fn();
  store.apply({ type: "setText", id: "r", text: "one\n" });
  cache = new ContentCache(store, changed);
  const before = store.schema, doc = cache.get("r");
  doc.transact(() => {
    doc.insert({ line: 0, column: 0 }, "X");
    doc.delete({ line: 0, column: 0 }, { line: 0, column: 1 });
    doc.delete({ line: 0, column: 3 }, { line: 1, column: 0 });
  });
  const range = changed.mock.calls[0][0].textChange;
  expect(range).toEqual({ contentId: "r", from: 3, oldEnd: 4, newEnd: 3 });
  store.restore(before);
  cache.restoreText({ ...range, oldEnd: range.newEnd, newEnd: range.oldEnd }, "one");
  expect(cache.get("r")).toBe(doc);
  expect(doc.text()).toBe("one\n");
});

it("merges backspace history across Unicode and newline boundaries", () => {
  const store = tree(), history = new AppHistory();
  store.apply({ type: "setText", id: "r", text: "one\n日本\nthree" });
  const original = store.schema;
  cache = new ContentCache(store, edit => {
    if (!edit) return;
    history.record({ schema: edit.before, path: [], focus: { contentId: "r", ...edit.beforeCaret! } },
      { schema: edit.after, path: [], focus: { contentId: "r", ...edit.afterCaret! } },
      { contentId: "r", intent: "backspace", group: edit.group }, edit.textChange, edit.textPatch);
  });
  const doc = cache.get("r");
  doc.delete({ line: 2, column: 0 }, { line: 2, column: 1 }, { line: 2, column: 1 });
  doc.delete({ line: 1, column: 2 }, { line: 2, column: 0 }, { line: 2, column: 0 });
  doc.delete({ line: 1, column: 1 }, { line: 1, column: 2 }, { line: 1, column: 2 });
  expect(doc.text()).toBe("one\n日hree");
  expect(history.undoCount).toBe(1);
  const undo = history.undo()!;
  store.restore(undo.schema);
  cache.restoreText(undo.textChange, "one\n日hree");
  expect(doc.text()).toBe(original.root[0].right.text);
  const redo = history.redo()!;
  store.restore(redo.schema);
  cache.restoreText(redo.textChange, original.root[0].right.text);
  expect(doc.text()).toBe("one\n日hree");
});
it("evicts the least recently used store and keeps the newly focused store", () => {
  const dispose = vi.spyOn(EditorDocument.prototype, "dispose");
  cache = new ContentCache(tree(), () => {}, 2);
  const first = cache.get("l");
  cache.get("l2");
  expect(cache.get("l")).toBe(first);
  cache.get("r");
  expect(cache.size).toBe(2);
  expect(dispose).toHaveBeenCalledOnce();
  expect(cache.get("l")).toBe(first);
});
it("disposes removed Contents and rebuilds stale documents after snapshot-like tree restoration", () => {
  const store = tree(),
    dispose = vi.spyOn(EditorDocument.prototype, "dispose");
  cache = new ContentCache(store, () => {});
  const doc = cache.get("r");
  const inverse = store.apply({ type: "setText", id: "r", text: "external" });
  expect(cache.get("r")).not.toBe(doc);
  store.apply(inverse);
  expect(cache.get("r").text()).toBe("right");
  cache.get("l");
  store.apply({ type: "removeContent", id: "l" });
  cache.prune();
  expect(dispose).toHaveBeenCalledTimes(3);
  expect(() => cache.get("l")).toThrow();
});

it("keeps snapshot undo valid after more than 50 editor stores have been evicted", async () => {
  const { AppHistory } = await import("../history/history.svelte.js");
  const store = new TreeStore({
    version: 1,
    root: Array.from({ length: 60 }, (_, i) => ({
      id: `row${i}`,
      left: [{ id: `l${i}`, text: "" }],
      right: { id: `r${i}`, text: "original", children: [] },
    })),
  });
  const history = new AppHistory();
  cache = new ContentCache(store, (edit) => {
    history.record(
      { schema: edit!.before, path: [], focus: null },
      { schema: edit!.after, path: [], focus: null },
    );
  });
  cache.get("r0").insert({ line: 0, column: 0 }, "!");
  for (let i = 1; i < 60; i++) cache.get(`r${i}`);
  expect(cache.size).toBe(50);
  cache.dispose();
  store.restore(history.undo()!.schema);
  cache = new ContentCache(store, () => {});
  expect(cache.get("r0").text()).toBe("original");
  cache.dispose();
  store.restore(history.redo()!.schema);
  cache = new ContentCache(store, () => {});
  expect(cache.get("r0").text()).toBe("!original");
});
