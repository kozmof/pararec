import { afterEach, expect, it, vi } from "vitest";
import { TreeStore } from "../tree/tree-store.svelte.js";
import { ContentCache } from "./content-cache.js";
import { EditorDocument } from "./document-store.svelte.js";
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
