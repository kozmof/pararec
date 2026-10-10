import { describe, expect, it } from "vitest";
import { AppHistory, type AppSnapshot, type TypingGroup } from "./history.svelte.js";
import type { Schema } from "../../schema.js";
function snapshot(text: string, column = text.length): AppSnapshot {
  const schema: Schema = {
    version: 1,
    title: "document",
    config: {
      showTitles: true,
      outerWidthRate: { left: 35, right: 65 },
      innerIdthRate: { left: 35, right: 65 },
    },
    root: [
      { id: "row", left: [{ id: "left", text: "" }], right: { id: "right", text, children: [] } },
    ],
  };
  return { schema, path: [], focus: { contentId: "right", line: 0, column } };
}
const typing = (time: number, extra: Partial<TypingGroup> = {}): TypingGroup => ({
  contentId: "right",
  intent: "insert",
  group: 1,
  time,
  ...extra,
});
describe("app snapshot history", () => {
  it("groups contiguous typing and restores the first caret and final caret", () => {
    const history = new AppHistory(),
      a = snapshot(""),
      b = snapshot("a"),
      c = snapshot("ab");
    history.record(a, b, typing(0));
    history.record(b, c, typing(300));
    expect(history.undoCount).toBe(1);
    expect(history.undo()).toEqual(a);
    expect(history.redo()).toEqual(c);
  });
  it.each([
    ["timeout", typing(301)],
    ["content", typing(1, { contentId: "left" })],
    ["intent", typing(1, { intent: "backspace" })],
    ["native group", typing(1, { group: 2 })],
    ["clock reversal", typing(-1)],
  ])("separates typing after a different %s", (_name, next) => {
    const history = new AppHistory(),
      a = snapshot(""),
      b = snapshot("a"),
      c = snapshot("ab");
    history.record(a, b, typing(0));
    history.record(b, c, next as TypingGroup);
    expect(history.undoCount).toBe(2);
  });
  it("separates caret changes, paths, structure actions, and explicit boundaries", () => {
    const history = new AppHistory(),
      values = Array.from({ length: 6 }, (_, i) => snapshot("a".repeat(i)));
    history.record(values[0], values[1], typing(0));
    history.record(
      { ...values[1], focus: { ...values[1].focus!, column: 0 } },
      values[2],
      typing(1),
    );
    history.record({ ...values[2], path: ["row"] }, values[3], typing(2));
    history.record(values[3], values[4]);
    history.closeGroup();
    history.record(values[4], values[5], typing(3));
    expect(history.undoCount).toBe(5);
  });
  it("clears redo on a new edit and starts a fresh typing group after undo", () => {
    const history = new AppHistory(),
      a = snapshot(""),
      b = snapshot("a"),
      c = snapshot("b"),
      d = snapshot("bc");
    history.record(a, b, typing(0));
    history.undo();
    history.record(a, c, typing(1));
    history.record(c, d, typing(2));
    expect(history.canRedo).toBe(false);
    expect(history.undoCount).toBe(1);
    expect(history.undo()).toEqual(a);
  });
  it("retains immutable schemas but copies mutable navigation state", () => {
    const history = new AppHistory(),
      a = snapshot(""),
      b = snapshot("a");
    history.record(a, b);
    a.path.push("changed");
    a.focus!.column = 9;
    const restored = history.undo()!;
    expect(restored.schema).toBe(a.schema);
    expect(restored.path).toEqual([]);
    expect(restored.focus!.column).toBe(0);
    restored.path.push("mutated");
    history.redo();
    expect(history.undo()!.path).toEqual([]);
  });
  it("caps history at 500 actions and clears both stacks", () => {
    const history = new AppHistory();
    let before = snapshot("0");
    for (let i = 1; i <= 520; i++) {
      const after = snapshot(String(i));
      history.record(before, after);
      before = after;
    }
    expect(history.undoCount).toBe(500);
    for (let i = 519; i >= 20; i--)
      expect(history.undo()!.schema.root[0].right.text).toBe(String(i));
    expect(history.undo()).toBeNull();
    for (let i = 21; i <= 520; i++)
      expect(history.redo()!.schema.root[0].right.text).toBe(String(i));
    expect(history.redo()).toBeNull();
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});

it("restores and replays 20 mixed text and structure actions", async () => {
  const { TreeStore } = await import("../tree/tree-store.svelte.js");
  const { structureAction } = await import("../tree/structure.js");
  const tree = new TreeStore(snapshot("original").schema),
    history = new AppHistory();
  const first = tree.schema;
  for (let i = 0; i < 20; i++) {
    const before = { ...snapshot(""), schema: tree.schema };
    if (i % 2 === 0) tree.apply({ type: "setText", id: "right", text: `edit ${i}` });
    else {
      const plan = structureAction(
        tree.schema,
        tree.index,
        [],
        "right",
        { line: 0, column: 0 },
        "newChild",
      )!;
      tree.applyMany(plan.ops);
    }
    history.record(before, { ...before, schema: tree.schema });
  }
  const last = tree.schema;
  for (let i = 0; i < 20; i++) tree.restore(history.undo()!.schema);
  expect(tree.schema).toEqual(first);
  expect(tree.index.size).toBe(3);
  for (let i = 0; i < 20; i++) tree.restore(history.redo()!.schema);
  expect(tree.schema).toEqual(last);
  expect(tree.index.size).toBe(33);
});
