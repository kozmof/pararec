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
