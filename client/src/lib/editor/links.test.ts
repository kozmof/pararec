import { expect, test } from "vitest";
import { EditorDocument } from "./document-store.svelte.js";

test("Reed attention tracks linked Unicode text and fails closed after deletion", () => {
  const doc = new EditorDocument("Hi 日本語 world");
  try {
    const range = doc.linkRange({ line: 0, column: 3 }, { line: 0, column: 6 });
    doc.syncLinks([{ id: "link", sourceId: "source", ...range, targets: ["target"] }]);
    expect(doc.resolvedLinks()[0]).toMatchObject({ start: 3, end: 12 });
    doc.insert({ line: 0, column: 0 }, "👋 ");
    expect(doc.resolvedLinks()[0]).toMatchObject({ start: 8, end: 17 });
    doc.delete({ line: 0, column: 6 }, { line: 0, column: 9 });
    expect(doc.resolvedLinks()).toEqual([]);
  } finally { doc.dispose(); }
});

import { TreeStore } from "../tree/tree-store.svelte.js";
import { ContentCache } from "./content-cache.js";
test("saved link offsets follow edits and survive cache eviction", () => {
  const tree = new TreeStore({ version: 1, root: [{ id: "row", left: [{ id: "left", text: "hello world" }], right: { id: "right", text: "target", children: [] } }], links: [{ id: "link", sourceId: "left", start: 6, end: 11, targets: ["right"] }] });
  const cache = new ContentCache(tree, () => {}, 1);
  try {
    cache.get("left").insert({ line: 0, column: 0 }, "日本 ");
    expect(tree.schema.links?.[0]).toMatchObject({ start: 13, end: 18 });
    cache.get("right");
    expect(cache.get("left").resolvedLinks()[0]).toMatchObject({ start: 13, end: 18 });
  } finally { cache.dispose(); }
});
