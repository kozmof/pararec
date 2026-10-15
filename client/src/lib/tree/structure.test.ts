import { describe, expect, it } from "vitest";
import { MAX_CONTAINER_DEPTH, parseSchema, type Container } from "../../schema.js";
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

it.each(["split"] as const)("preserves UTF-8 labels across %s, undo, and redo", command => {
  const tree = new TreeStore({ version: 1, root: [row("a", ["日本abcd"]), row("b")], links: [
    { id: "before", sourceId: "a-l0", start: 0, end: 3, targets: ["b-r"] },
    { id: "after", sourceId: "a-l0", start: 6, end: 10, targets: ["b-r"] },
    { id: "cross", sourceId: "a-l0", start: 3, end: 8, targets: ["b-r"] },
  ] });
  const result = action(tree, "a-l0", command, 0, 2)!;
  expect(tree.schema.links).toEqual(expect.arrayContaining([
    { id: "before", sourceId: "a-l0", start: 0, end: 3, targets: ["b-r"] },
    { id: "after", sourceId: result.focus!.contentId, start: 0, end: 4, targets: ["b-r"] },
    { id: "cross", sourceId: "a-l0", start: 3, end: 6, targets: ["b-r"] },
    expect.objectContaining({ sourceId: result.focus!.contentId, start: 0, end: 2, targets: ["b-r"] }),
  ]));
});

it("joins labels and destinations and cleans up references on removal", () => {
  const tree = new TreeStore({ version: 1, root: [row("a", ["日", "本"]), row("b")], links: [
    { id: "source", sourceId: "a-l1", start: 0, end: 3, targets: ["b-r"] },
    { id: "target", sourceId: "b-r", start: 0, end: 1, targets: ["a-l0", "a-l1"] },
  ] });
  action(tree, "a-l1", "join");
  expect(tree.schema.links).toEqual([
    { id: "source", sourceId: "a-l0", start: 4, end: 7, targets: ["b-r"] },
    { id: "target", sourceId: "b-r", start: 0, end: 1, targets: ["a-l0"] },
  ]);
  action(tree, "b-r", "removeRow");
  expect(tree.schema.links ?? []).toEqual([]);
});

it("rejects invalid link operations and rolls back invalid compound edits", () => {
  const tree = new TreeStore({ version: 1, root: [row("a", ["日本"]), row("b")], links: [
    { id: "label", sourceId: "a-l0", start: 0, end: 6, targets: ["b-r"] },
  ] });
  const before = tree.schema;
  expect(() => tree.apply({ type: "setLinks", links: [{ ...before.links![0], start: 1 }] })).toThrow("byte range");
  expect(() => tree.applyMany([{ type: "setText", id: "a-l0", text: "" }])).toThrow("byte range");
  expect(tree.schema).toBe(before);
  expect(tree.revision).toBe(0);
  expect([...tree.index.entries()].sort()).toEqual([...buildIndex(before).entries()].sort());
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
  expect(parseSchema(tree.schema)).toEqual({ ...tree.schema, links: tree.schema.links?.length ? tree.schema.links : undefined });
  expect([...tree.index.entries()].sort()).toEqual([...buildIndex(tree.schema).entries()].sort());
  const after = tree.schema;
  tree.applyMany(inverse);
  expect(tree.schema).toEqual(before);
  tree.applyMany(result.ops);
  expect(tree.schema).toEqual(after);
  return result;
}
describe("structure actions", () => {
  it("removes a populated left cell and preserves the last left cell", () => {
    const tree = store();
    const result = action(tree, "a-l0", "removeLeft")!;
    expect(tree.schema.root[0].left.map(note => note.id)).toEqual(["a-l1"]);
    expect(result.focus?.contentId).toBe("a-l1");
    expect(action(tree, "a-l1", "removeLeft")).toBeNull();
  });
  it("removes all child subtrees while keeping the right note and caret", () => {
    const tree = new TreeStore({ version: 1, root: [row("a", ["left"], "first\nsecond", [row("child", ["child left"], "child right", [row("grandchild")])])] });
    const result = action(tree, "a-r", "removeChildren", 0, 2)!;
    expect(tree.schema.root[0].right.children).toEqual([]);
    expect(tree.schema.root[0].right.text).toBe("first\nsecond");
    expect(result.focus).toEqual({ contentId: "a-r", entry: { kind: "caret", line: 0, column: 2 } });
    expect(action(tree, "a-r", "removeChildren")).toBeNull();
  });
  it.each(["a-l0", "a-r"])("removes a populated row and descendants from %s", id => {
    const tree = store();
    const result = action(tree, id, "removeRow")!;
    expect(tree.schema.root.map(row => row.id)).toEqual(["b"]);
    expect(result.focus?.contentId).toBe(id === "a-r" ? "b-r" : "b-l0");
  });
  it("removes the last child and returns focus to its parent", () => {
    const tree = store();
    const result = action(tree, "child-r", "removeRow", 0, 0, ["a"])!;
    expect(result.focus?.contentId).toBe("a-r");
    expect(result.path).toEqual(["a"]);
  });
  it("removes the final root row without a focus target", () => {
    const tree = store();
    action(tree, "a-r", "removeRow");
    expect(action(tree, "b-r", "removeRow")?.focus).toBeNull();
    expect(tree.schema.root).toEqual([]);
  });
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
  it.each([
    ["a-l0", 0, 0], ["a-r", 0, 0],
    ["a-l0", 0, 1], ["a-r", 0, 1],
    ["a-l0", 1, 9], ["a-r", 1, 6],
  ] as const)("keeps text and links in %s when creating a sibling at %i:%i", (id, line, column) => {
    const tree = new TreeStore({ version: 1, root: [row("a", ["日本\n👩‍🚀tail"], "日本\nsecond", [row("child")]), row("b")], links: [
      { id: "label", sourceId: id, start: 0, end: 6, targets: ["b-r"] },
      { id: "incoming", sourceId: "b-r", start: 0, end: 1, targets: [id] },
    ] });
    const before = tree.schema;
    const result = action(tree, id, "newSibling", line, column)!;
    expect(tree.schema.root[0]).toEqual(before.root[0]);
    expect(tree.schema.links).toEqual(before.links);
    expect(tree.schema.root[1].left[0].text).toBe("");
    expect(tree.schema.root[1].right.text).toBe("");
    expect(tree.schema.root[2]).toEqual(before.root[1]);
    expect(result.focus).toEqual({
      contentId: id === "a-l0" ? tree.schema.root[1].left[0].id : tree.schema.root[1].right.id,
      entry: { kind: "edge", edge: "start" },
    });
  });
  it("keeps text at the start of a later line", () => {
    const tree = store();
    action(tree, "a-r", "newSibling", 1, 0);
    expect(tree.schema.root.map(row => row.right.text)).toEqual(["first\nsecond", "", "right"]);
  });
  it("creates an empty sibling and leaves text and children with the original row", () => {
    const tree = store(),
      result = action(tree, "a-r", "newSibling", 0, 2)!;
    expect(tree.schema.root.map((row) => row.right.text)).toEqual(["first\nsecond", "", "right"]);
    expect(tree.schema.root[0].right.children[0].id).toBe("child");
    expect(tree.schema.root[1].left[0].text).toBe("");
    expect(result.focus!.contentId).toBe(tree.schema.root[1].right.id);
  });
  it.each(["a", "child"])("prepends a two-column child from the full-width parent %s", id => {
    const tree = store();
    const path = id === "a" ? ["a"] : ["a", "child"];
    const before = tree.index.get(id)!.container;
    const rootCount = tree.schema.root.length;
    const result = action(tree, before.right.id, "newSibling", 0, 0, path)!;
    const parent = tree.index.get(id)!.container;
    const child = parent.right.children[0];
    expect(parent.left).toEqual(before.left);
    expect(parent.right.text).toBe(before.right.text);
    expect(parent.right.children.slice(1)).toEqual(before.right.children);
    expect(child.left).toHaveLength(1);
    expect(child.left[0].text).toBe("");
    expect(child.right.text).toBe("");
    expect(tree.schema.root).toHaveLength(rootCount);
    expect(result.path).toEqual(path);
    expect(result.focus).toEqual({ contentId: child.right.id, entry: { kind: "edge", edge: "start" } });
  });
  it("keeps ordinary sibling creation away from the full-width parent's start", () => {
    const tree = store();
    const before = tree.schema.root[0].right.children;
    action(tree, "a-r", "newSibling", 0, 1, ["a"]);
    expect(tree.schema.root).toHaveLength(3);
    expect(tree.schema.root[0].right.children).toEqual(before);
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

it.each(["a-l0", "child-l0"])("creates a sibling row from left note %s at the same level", id => {
  const tree = store();
  const parentId = tree.index.get(id)!.parentId;
  const before = tree.index.get(id)!.container;
  const result = action(tree, id, "newSibling", 0, 1)!;
  const siblings = parentId === null ? tree.schema.root : tree.index.get(parentId)!.container.right.children;
  const at = siblings.findIndex(row => row.id === before.id);
  const sibling = siblings[at + 1];
  expect(siblings[at].left[0].text).toBe(before.left[0].text);
  expect(sibling.left[0].text).toBe("");
  expect(sibling.right.text).toBe("");
  expect(siblings[at].right).toEqual(before.right);
  expect(result.focus!.contentId).toBe(sibling.left[0].id);
});

it("does not prepend a child beyond the nesting limit", () => {
  let rows: Container[] = [];
  for (let depth = MAX_CONTAINER_DEPTH - 1; depth >= 0; depth--)
    rows = [row(`depth-${depth}`, ["left"], "right", rows)];
  const tree = new TreeStore({ version: 1, root: rows });
  const path = Array.from({ length: MAX_CONTAINER_DEPTH }, (_, depth) => `depth-${depth}`);
  expect(action(tree, `depth-${MAX_CONTAINER_DEPTH - 1}-r`, "newSibling", 0, 0, path)).toBeNull();
  expect(tree.revision).toBe(0);
});

it.each(["a-l0", "a-r", "child-l0", "child-r"])("inserts a record above %s without changing its text, links, or children", id => {
  const tree = store();
  const source = tree.index.get(id)!;
  const text = source.side === "left" ? source.container.left[source.index].text : source.container.right.text;
  tree.apply({ type: "setLinks", links: [{ id: "label", sourceId: id, start: 0, end: new TextEncoder().encode([...text][0]).length, targets: ["b-r"] }] });
  const entry = tree.index.get(id)!;
  const before = entry.container;
  const links = tree.schema.links;
  const path = id.startsWith("child") ? ["a"] : [];
  const result = action(tree, id, "newSiblingBefore", 0, 1, path)!;
  const rows = entry.parentId ? tree.index.get(entry.parentId)!.container.right.children : tree.schema.root;
  const at = rows.findIndex(row => row.id === before.id);
  const inserted = rows[at - 1];
  expect(inserted.left).toHaveLength(1);
  expect(inserted.left[0].text).toBe("");
  expect(inserted.right.text).toBe("");
  expect(inserted.right.children).toEqual([]);
  expect(rows[at]).toEqual(before);
  expect(tree.schema.links).toEqual(links);
  expect(result.path).toEqual(path);
  expect(result.focus!.contentId).toBe(entry.side === "left" ? inserted.left[0].id : inserted.right.id);
});
it("reveals the inserted upper sibling when invoked from the full-width parent", () => {
  const tree = store();
  const result = action(tree, "child-r", "newSiblingBefore", 0, 0, ["a", "child"])!;
  expect(result.path).toEqual(["a"]);
  const children = tree.schema.root[0].right.children;
  expect(children[0].right.text).toBe("");
  expect(children[1].id).toBe("child");
  expect(result.focus!.contentId).toBe(children[0].right.id);
});
