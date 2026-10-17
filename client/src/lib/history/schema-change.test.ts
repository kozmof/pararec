import { expect, it } from "vitest";
import { TreeStore } from "../tree/tree-store.svelte.js";
import { AppHistory } from "./history.svelte.js";
import { schemaChanges, applySchemaChanges } from "./schema-change.js";

function tree() {
  return new TreeStore({
    version: 1,
    root: [
      {
        id: "a",
        left: [{ id: "al", text: "" }],
        right: { id: "ar", text: "日👩🏽‍💻".repeat(1000), children: [] },
      },
      {
        id: "b",
        left: [{ id: "bl", text: "" }],
        right: { id: "br", text: "untouched", children: [] },
      },
    ],
  });
}

it("records row moves without retaining their text and preserves shared branches", () => {
  const store = tree(),
    before = store.schema;
  store.apply({ type: "moveContainer", id: "a", parentId: null, index: 1 });
  const after = store.schema,
    changes = schemaChanges(before, after);
  expect(JSON.stringify(changes).length).toBeLessThan(300);
  const restored = applySchemaChanges(after, changes, true);
  expect(restored).toEqual(before);
  expect(restored.root[0]).toBe(before.root[0]);
  expect(applySchemaChanges(restored, changes, false)).toEqual(after);
});

it("restores mixed reorder, insertion, removal, nested edits, and optional links", () => {
  const store = tree(),
    before = store.schema;
  store.applyMany([
    { type: "moveContainer", id: "b", parentId: "a", index: 0 },
    { type: "setText", id: "br", text: "changed" },
    { type: "insertContent", containerId: "a", index: 1, content: { id: "new", text: "new cell" } },
    { type: "removeContent", id: "al" },
    {
      type: "setLinks",
      links: [{ id: "link", sourceId: "br", start: 0, end: 3, targets: ["ar"] }],
    },
  ]);
  const after = store.schema,
    changes = schemaChanges(before, after);
  const restored = applySchemaChanges(after, changes, true);
  expect(restored).toEqual(before);
  expect("links" in restored).toBe(false);
  expect(applySchemaChanges(restored, changes, false)).toEqual(after);
});

it("keeps structural undo on a large document within a small history budget", () => {
  const store = tree(),
    history = new AppHistory(500, 1500);
  const before = store.schema;
  store.apply({ type: "setTitle", title: "Renamed" });
  const renamed = store.schema;
  history.record(
    { schema: before, path: [], focus: null },
    { schema: renamed, path: [], focus: null },
  );
  store.apply({ type: "moveContainer", id: "b", parentId: null, index: 0 });
  const after = store.schema;
  history.record(
    { schema: renamed, path: [], focus: null },
    { schema: after, path: [], focus: null },
  );
  expect(history.undoCount).toBe(2);
  store.restore(history.undo()!.schema);
  expect(store.schema).toEqual(renamed);
  store.restore(history.undo()!.schema);
  expect(store.schema).toEqual(before);
  store.restore(history.redo()!.schema);
  store.restore(history.redo()!.schema);
  expect(store.schema).toEqual(after);
});

it("restores a large removed subtree even when the latest action exceeds the budget", () => {
  const store = tree();
  const history = new AppHistory(500, 1024);
  const before = store.schema;
  const snap = () => ({ schema: store.schema, path: [], focus: null });
  const first = snap();
  store.apply({ type: "setTitle", title: "Renamed" });
  history.record(first, snap());
  const renamed = snap();
  store.apply({ type: "removeContainer", id: "a" });
  history.record(renamed, snap());
  const removed = store.schema;
  expect(history.undoCount).toBe(1);
  store.restore(history.undo()!.schema);
  expect(store.schema.root[0]).toBe(before.root[0]);
  expect(store.schema.title).toBe("Renamed");
  store.restore(history.redo()!.schema);
  expect(store.schema).toEqual(removed);
});
