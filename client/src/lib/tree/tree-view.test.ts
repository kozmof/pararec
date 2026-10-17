import { expect, it } from "vitest";
import { parseSchema } from "../../schema.js";
import { TreeStore } from "./tree-store.svelte.js";

function row(id: string, children: ReturnType<typeof parseSchema>["root"] = []) {
  return {
    id,
    left: [{ id: `${id}-l`, text: "left" }],
    right: { id: `${id}-r`, text: "hello", children },
  };
}

it("keeps the 1000-row UI list stable through linked text edits", () => {
  const tree = new TreeStore({
    version: 1,
    root: Array.from({ length: 1000 }, (_, i) => row(String(i))),
    links: [{ id: "label", sourceId: "0-r", start: 0, end: 5, targets: ["999-r"] }],
  });
  const before = tree.schema;
  const rows = tree.rowsAt([]),
    first = rows[0],
    right = first.right;
  for (let i = 1; i <= 100; i++) {
    tree.setTextAndLinks("0-r", "x".repeat(i) + "hello", [
      { ...before.links![0], start: i, end: i + 5 },
    ]);
    expect(tree.rowsAt([])).toBe(rows);
    expect(rows[0]).toBe(first);
    expect(rows[0].right).toBe(right);
    expect(right.text).toBe("x".repeat(i) + "hello");
  }
  expect(before.root[0].right.text).toBe("hello");
  expect(parseSchema({ ...tree.schema, root: rows })).toEqual(tree.schema);
});

it("keeps ancestor and child lists stable for nested text edits and updates structure", () => {
  const tree = new TreeStore({ version: 1, root: [row("a", [row("b", [row("c")])]), row("d")] });
  const root = tree.rowsAt([]),
    children = tree.rowsAt(["a"]),
    grandchildren = tree.rowsAt(["a", "b"]);
  const before = tree.schema;
  tree.apply({ type: "setText", id: "c-r", text: "edited" });
  expect(tree.rowsAt([])).toBe(root);
  expect(tree.rowsAt(["a"])).toBe(children);
  expect(tree.rowsAt(["a", "b"])).toBe(grandchildren);
  expect(grandchildren[0].right.text).toBe("edited");
  tree.apply({ type: "moveContainer", id: "d", parentId: "b", index: 1 });
  expect(tree.rowsAt([])).not.toBe(root);
  expect(tree.rowsAt(["a"])).toBe(children);
  expect(tree.rowsAt(["a", "b"]).map((row) => row.id)).toEqual(["c", "d"]);
  tree.restore(before);
  expect(parseSchema({ ...tree.schema, root: tree.rowsAt([]) })).toEqual(before);
  expect(tree.rowView("c")!.right.text).toBe("hello");
});

it("publishes no presentation changes for rejected compound actions", () => {
  const tree = new TreeStore({ version: 1, root: [row("a")] });
  const rows = tree.rowsAt([]);
  expect(() =>
    tree.applyMany([
      { type: "setText", id: "a-r", text: "must not publish" },
      { type: "setText", id: "missing", text: "invalid" },
    ]),
  ).toThrow();
  expect(tree.rowsAt([])).toBe(rows);
  expect(rows[0].right.text).toBe("hello");
});

it("drops deleted row views when an ID is reused by a cell", () => {
  const tree = new TreeStore({ version: 1, root: [row("a"), row("b")] });
  tree.applyMany([
    { type: "removeContainer", id: "a" },
    { type: "insertContent", containerId: "b", index: 1, content: { id: "a", text: "reused" } },
  ]);
  expect(tree.rowView("a")).toBeUndefined();
  expect(tree.rowsAt([]).map((row) => row.id)).toEqual(["b"]);
  expect(parseSchema({ ...tree.schema, root: tree.rowsAt([]) })).toEqual(tree.schema);
});
