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

for (const text of ["fooabc", "foo"]) {
  test(`typing at the label end stays outside it in ${text}`, () => {
    const doc = new EditorDocument(text);
    try {
      doc.syncLinks([{ id: "link", sourceId: "source", start: 0, end: 3, targets: ["target"] }]);
      doc.insert({ line: 0, column: 3 }, "x");
      expect(doc.text()).toBe("foox" + text.slice(3));
      expect(doc.resolvedLinks()[0]).toMatchObject({ start: 0, end: 3 });
      doc.insert({ line: 0, column: 4 }, "日本");
      expect(doc.resolvedLinks()[0]).toMatchObject({ start: 0, end: 3 });
    } finally { doc.dispose(); }
  });
}

test("typing inside a label expands it, while an IME commit at its end stays outside", () => {
  const doc = new EditorDocument("fooabc");
  try {
    doc.syncLinks([{ id: "link", sourceId: "source", start: 0, end: 3, targets: ["target"] }]);
    doc.insert({ line: 0, column: 1 }, "x");
    expect(doc.resolvedLinks()[0]).toMatchObject({ start: 0, end: 4 });
    doc.transact(current => current.replace({ line: 0, column: 4 }, { line: 0, column: 4 }, "日本"), "composition");
    expect(doc.text()).toBe("fxoo日本abc");
    expect(doc.resolvedLinks()[0]).toMatchObject({ start: 0, end: 4 });
  } finally { doc.dispose(); }
});

for (const inserted of ["x", "日本"]) {
  test(`typing ${inserted} at a label end after deleting its last character stays outside`, () => {
    const doc = new EditorDocument("footext");
    try {
      doc.syncLinks([{ id: "link", sourceId: "source", start: 0, end: 3, targets: ["target"] }]);
      doc.delete({ line: 0, column: 2 }, { line: 0, column: 3 });
      expect(doc.resolvedLinks()[0]).toMatchObject({ start: 0, end: 2 });
      if (inserted === "x") doc.insert({ line: 0, column: 2 }, inserted);
      else doc.transact(current => current.replace({ line: 0, column: 2 }, { line: 0, column: 2 }, inserted), "composition");
      expect(doc.text()).toBe("fo" + inserted + "text");
      expect(doc.resolvedLinks()[0]).toMatchObject({ start: 0, end: 2 });
    } finally { doc.dispose(); }
  });
}
