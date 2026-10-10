import { describe, expect, it } from "vitest";
import { parseSchema, type Container, type Schema } from "../../schema.js";
import { buildIndex } from "./index.js";
import { applyOp, type Op } from "./ops.js";
import { TreeStore } from "./tree-store.svelte.js";

function row(id: string, children: Container[] = []): Container {
  return {
    id,
    left: [
      { id: `${id}-l`, text: "left" },
      { id: `${id}-l2`, text: "second" },
    ],
    right: { id: `${id}-r`, text: "right", children },
  };
}
function fixture(): Schema {
  return {
    version: 1,
    title: "document",
    config: {
      showTitles: true,
      outerWidthRate: { left: 35, right: 65 },
      innerIdthRate: { left: 35, right: 65 },
    },
    root: [row("a", [row("b", [row("c")])]), row("d")],
  };
}
function check(store: TreeStore) {
  expect(parseSchema(store.schema)).toEqual(store.schema);
  expect([...store.index.entries()].sort()).toEqual([...buildIndex(store.schema).entries()].sort());
  for (const [id, entry] of store.index) {
    expect(entry.container).toBe(buildIndex(store.schema).get(id)!.container);
  }
}

describe("immutable tree operations", () => {
  const operations: Op[] = [
    { type: "insertContainer", parentId: null, index: 1, container: row("new", [row("nested")]) },
    { type: "insertContainer", parentId: "b", index: 1, container: row("new") },
    { type: "removeContainer", id: "c" },
    { type: "moveContainer", id: "d", parentId: "b", index: 0 },
    { type: "moveContainer", id: "c", parentId: null, index: 0 },
    { type: "moveContainer", id: "a", parentId: null, index: 1 },
    { type: "insertContent", containerId: "b", index: 1, content: { id: "new", text: "a\r\nb" } },
    { type: "removeContent", id: "b-l" },
    { type: "moveContent", id: "a-l", containerId: "b", index: 1 },
    { type: "moveContent", id: "b-l", containerId: "a", index: 1 },
    { type: "moveContent", id: "d-l", containerId: "a", index: 1 },
    { type: "moveContent", id: "b-l", containerId: "b", index: 1 },
    { type: "setText", id: "c-r", text: "updated\rtext" },
    { type: "setText", id: "b-l", text: "updated" },
  ];
  it.each(operations)("round trips $type for $id", (op) => {
    const store = new TreeStore(fixture()),
      before = store.schema;
    const frozen = JSON.stringify(before);
    const inverse = store.apply(op);
    check(store);
    expect(JSON.stringify(before)).toBe(frozen);
    store.apply(inverse);
    expect(store.schema).toEqual(before);
    check(store);
  });
  it("preserves untouched branches and index entries", () => {
    const store = new TreeStore(fixture()),
      before = store.schema;
    const entry = store.index.get("d"),
      child = store.index.get("c");
    store.apply({ type: "setText", id: "b-r", text: "changed" });
    expect(store.schema.root[1]).toBe(before.root[1]);
    expect(store.index.get("d")).toBe(entry);
    expect(store.index.get("c")).toBe(child);
    expect(store.schema.root[0].left).toBe(before.root[0].left);
  });
  it.each<Op>([
    { type: "moveContainer", id: "a", parentId: "c", index: 0 },
    { type: "moveContainer", id: "a", parentId: "a", index: 0 },
    { type: "removeContainer", id: "a" },
    { type: "insertContainer", parentId: null, index: 0, container: row("a") },
    { type: "insertContent", containerId: "a", index: 0, content: { id: "c-r", text: "" } },
    { type: "moveContent", id: "a-r", containerId: "b", index: 0 },
    { type: "setText", id: "a", text: "" },
    { type: "moveContainer", id: "d", parentId: "missing", index: 0 },
    { type: "insertContent", containerId: "a", index: -1, content: { id: "new", text: "" } },
    { type: "moveContainer", id: "d", parentId: null, index: 3 },
  ])("rejects invalid $type without modifying state", (op) => {
    const store = new TreeStore(fixture()),
      before = store.schema;
    expect(() => store.apply(op)).toThrow();
    expect(store.schema).toBe(before);
    expect(store.revision).toBe(0);
    check(store);
  });
  it("retains the final left Content", () => {
    const store = new TreeStore(fixture());
    store.apply({ type: "removeContent", id: "a-l2" });
    expect(() => store.apply({ type: "removeContent", id: "a-l" })).toThrow();
    expect(() =>
      store.apply({ type: "moveContent", id: "a-l", containerId: "b", index: 0 }),
    ).toThrow();
    check(store);
  });
  it("checks invariants after deterministic random edits and reverses the entire sequence", () => {
    const store = new TreeStore(fixture()),
      before = store.schema;
    const inverses: Op[] = [];
    let seed = 241;
    const random = (length: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % length;
    };
    for (let turn = 0; turn < 200; turn++) {
      const rows = [...store.index.values()].filter((entry) => entry.side === "container");
      const target = rows[random(rows.length)].container;
      const type = random(7);
      let op: Op;
      if (type === 0)
        op = {
          type: "insertContainer",
          parentId: target.id,
          index: target.right.children.length,
          container: row(`new-${turn}`),
        };
      else if (type === 1)
        op = {
          type: "insertContent",
          containerId: target.id,
          index: random(target.left.length + 1),
          content: { id: `note-${turn}`, text: "日本\r\n👩‍🚀" },
        };
      else if (type === 2 && target.left.length > 1)
        op = { type: "removeContent", id: target.left[random(target.left.length)].id };
      else if (type === 3 && target.right.children.length === 0)
        op = { type: "removeContainer", id: target.id };
      else if (type === 4) op = { type: "moveContainer", id: target.id, parentId: null, index: 0 };
      else if (type === 5 && target.left.length > 1)
        op = {
          type: "moveContent",
          id: target.left[0].id,
          containerId: rows[random(rows.length)].container.id,
          index: 0,
        };
      else op = { type: "setText", id: target.right.id, text: `text ${turn}` };
      inverses.push(store.apply(op));
      check(store);
      if (!store.schema.root.length)
        inverses.push(
          store.apply({
            type: "insertContainer",
            parentId: null,
            index: 0,
            container: row(`root-${turn}`),
          }),
        );
    }
    for (const inverse of inverses.reverse()) {
      store.apply(inverse);
      check(store);
    }
    expect(store.schema).toEqual(before);
  });
  it("is pure when called without a store", () => {
    const before = fixture();
    const result = applyOp(before, { type: "setText", id: "a-r", text: "new" });
    expect(before.root[0].right.text).toBe("right");
    expect(result.schema.root[0].right.text).toBe("new");
  });
});

it("undoes an inserted subtree after a later edit is undone", () => {
  const store = new TreeStore(fixture()),
    before = store.schema;
  const undoInsert = store.apply({
    type: "insertContainer",
    parentId: null,
    index: 0,
    container: row("new", [row("nested")]),
  });
  const undoEdit = store.apply({ type: "setText", id: "nested-r", text: "edit" });
  store.apply(undoEdit);
  store.apply(undoInsert);
  expect(store.schema).toEqual(before);
});
