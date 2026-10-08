import { describe, expect, it } from "vitest";
import { parseSchema, type Container } from "../../schema.js";
import { TreeStore } from "./tree-store.svelte.js";
import { buildIndex } from "./index.js";
import { structureAction, type StructureCommand } from "./structure.js";
const row = (
  id: string,
  left = ["one", "two"],
  text = "right",
  children: Container[] = [],
): Container => ({
  id,
  left: left.map((text, at) => ({ id: `${id}-l${at}`, text })),
  right: { id: `${id}-r`, text, children },
});
const store = () =>
  new TreeStore({
    version: 1,
    root: [row("a", ["日本\n👩‍🚀tail", "second"], "first\nsecond", [row("child")]), row("b")],
  });
function action(
  tree: TreeStore,
  id: string,
  command: StructureCommand,
  line = 0,
  column = 0,
  path: string[] = [],
) {
  const before = tree.schema;
  const result = structureAction(before, tree.index, path, id, { line, column }, command);
  if (!result) return null;
  const revision = tree.revision;
  const inverse = tree.applyMany(result.ops);
  expect(tree.revision).toBe(revision + 1);
  expect(parseSchema(tree.schema)).toEqual(tree.schema);
  expect([...tree.index.entries()].sort()).toEqual([...buildIndex(tree.schema).entries()].sort());
  const after = tree.schema;
  tree.applyMany(inverse);
  expect(tree.schema).toEqual(before);
  tree.applyMany(result.ops);
  expect(tree.schema).toEqual(after);
  return result;
}
describe("structure actions", () => {
  it("splits a left note at a multiline grapheme boundary and preserves the first id", () => {
    const tree = store(),
      result = action(tree, "a-l0", "split", 1, 2)!;
    expect(tree.schema.root[0].left.map((note) => note.text)).toEqual([
      "日本\n",
      "👩‍🚀tail",
      "second",
    ]);
    expect(tree.schema.root[0].left[0].id).toBe("a-l0");
    expect(result.focus!.contentId).toBe(tree.schema.root[0].left[1].id);
  });
  it("creates a sibling with trailing text and leaves children with the original row", () => {
    const tree = store(),
      result = action(tree, "a-r", "newSibling", 0, 2)!;
    expect(tree.schema.root.map((row) => row.right.text)).toEqual(["fi", "rst\nsecond", "right"]);
    expect(tree.schema.root[0].right.children[0].id).toBe("child");
    expect(tree.schema.root[1].left[0].text).toBe("");
    expect(result.focus!.contentId).toBe(tree.schema.root[1].right.id);
  });
  it("joins with a newline and places the caret at the previous text's end", () => {
    const tree = store(),
      result = action(tree, "a-l1", "join")!;
    expect(tree.schema.root[0].left).toHaveLength(1);
    expect(tree.schema.root[0].left[0].text).toBe("日本\n👩‍🚀tail\nsecond");
    expect(result.focus).toEqual({
      contentId: "a-l0",
      entry: { kind: "caret", line: 1, column: 9 },
    });
  });
  it("appends children and enters the parent of a new grandchild", () => {
    const tree = store();
    const top = action(tree, "a-r", "newChild")!;
    expect(top.path).toEqual([]);
    expect(tree.schema.root[0].right.children).toHaveLength(2);
    const nested = action(tree, "child-r", "newChild")!;
    expect(nested.path).toEqual(["a", "child"]);
    expect(nested.focus!.contentId).toBe(
      tree.schema.root[0].right.children[0].right.children[0].right.id,
    );
  });
  it("keeps newly created children visible when their parent is a row in the current level", () => {
    const tree = store();
    expect(action(tree, "child-r", "newChild", 0, 0, ["a"])!.path).toEqual(["a"]);
  });
  it.each(["moveUp", "moveDown"] as const)(
    "moves rows with %s and retains the caret",
    (command) => {
      const tree = store(),
        id = command === "moveUp" ? "b-r" : "a-r";
      const result = action(tree, id, command, 0, 2)!;
      expect(tree.schema.root.map((row) => row.id)).toEqual(["b", "a"]);
      expect(result.focus).toEqual({ contentId: id, entry: { kind: "caret", line: 0, column: 2 } });
    },
  );
  it("moves left notes within a cell and across neighbouring rows", () => {
    const tree = store();
    action(tree, "a-l0", "moveDown");
    expect(tree.schema.root[0].left.map((note) => note.id)).toEqual(["a-l1", "a-l0"]);
    action(tree, "a-l0", "moveDown");
    expect(tree.schema.root[1].left[0].id).toBe("a-l0");
    action(tree, "a-l0", "moveUp");
    expect(tree.schema.root[0].left.at(-1)!.id).toBe("a-l0");
  });
  it("rejects moving the final left note across rows and commands at the outer edge", () => {
    const tree = new TreeStore({ version: 1, root: [row("a", ["only"]), row("b", ["only"])] });
    expect(action(tree, "a-l0", "moveDown")).toBeNull();
    expect(action(tree, "b-l0", "moveUp")).toBeNull();
    expect(action(tree, "a-r", "moveUp")).toBeNull();
    expect(action(tree, "b-r", "moveDown")).toBeNull();
    expect(action(tree, "a-l0", "join")).toBeNull();
    expect(tree.revision).toBe(0);
  });
  it("deletes only entirely empty childless rows and chooses the next right note", () => {
    const tree = new TreeStore({ version: 1, root: [row("empty", [""], ""), row("next")] });
    expect(action(tree, "next-r", "deleteContainer")).toBeNull();
    const result = action(tree, "empty-r", "deleteContainer")!;
    expect(tree.schema.root).toHaveLength(1);
    expect(result.focus!.contentId).toBe("next-r");
    expect(action(store(), "a-r", "deleteContainer")).toBeNull();
  });
  it("returns to Add row after deleting the current level's last row", () => {
    const tree = new TreeStore({ version: 1, root: [row("empty", [""], "")] });
    expect(action(tree, "empty-r", "deleteContainer")!.focus).toBeNull();
    expect(tree.schema.root).toEqual([]);
  });
  it("focuses the visible parent after deleting the final nested row", () => {
    const tree = new TreeStore({
      version: 1,
      root: [row("a", [""], "", [row("empty", [""], "")])],
    });
    expect(action(tree, "empty-r", "deleteContainer")!.focus!.contentId).toBe("a-r");
  });
  it("rolls back a rejected compound action without changing the tree, index, or revision", () => {
    const tree = store(),
      before = tree.schema,
      entries = [...tree.index.entries()];
    expect(() =>
      tree.applyMany([
        { type: "setText", id: "a-r", text: "temporary" },
        { type: "removeContainer", id: "a" },
      ]),
    ).toThrow();
    expect(tree.schema).toBe(before);
    expect([...tree.index.entries()]).toEqual(entries);
    expect(tree.revision).toBe(0);
  });
});

it("protects empty right notes whose left cell has text or whose Container has children", () => {
  const leftText = new TreeStore({ version: 1, root: [row("a", ["keep"], "")] });
  const children = new TreeStore({ version: 1, root: [row("a", [""], "", [row("child")])] });
  expect(action(leftText, "a-r", "deleteContainer")).toBeNull();
  expect(action(children, "a-r", "deleteContainer")).toBeNull();
  expect(leftText.revision).toBe(0);
  expect(children.revision).toBe(0);
});

it("preserves a moved caret's side of a wrap boundary", () => {
  const tree = store();
  const result = structureAction(
    tree.schema,
    tree.index,
    [],
    "a-r",
    { line: 0, column: 4, affinity: "upstream" },
    "moveDown",
  );
  expect(result!.focus!.entry).toEqual({ kind: "caret", line: 0, column: 4, affinity: "upstream" });
});
