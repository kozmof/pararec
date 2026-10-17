import { expect, it } from "vitest";
import { TreeStore } from "./tree-store.svelte.js";

function notebook() {
  return new TreeStore({
    version: 1,
    root: [
      {
        id: "a",
        left: [{ id: "al", text: "hello" }],
        right: { id: "ar", text: "hello", children: [] },
      },
      {
        id: "b",
        left: [{ id: "bl", text: "target" }],
        right: { id: "br", text: "target", children: [] },
      },
    ],
    links: [
      { id: "left-link", sourceId: "al", start: 0, end: 5, targets: ["br"] },
      { id: "right-link", sourceId: "ar", start: 0, end: 5, targets: ["bl"] },
    ],
  });
}

it("retains other sources' link identities across text edits and metadata changes", () => {
  const tree = notebook();
  const left = tree.linksFor("al"),
    right = tree.linksFor("ar"),
    empty = tree.linksFor("bl");
  tree.setTextAndLinks("al", "xhello", [
    { ...left[0], start: 1, end: 6 },
    ...right.map((link) => ({ ...link, targets: [...link.targets] })),
  ]);
  expect(tree.linksFor("al")[0]).toMatchObject({ start: 1, end: 6 });
  expect(tree.linksFor("ar")).toBe(right);
  expect(tree.linksFor("bl")).toBe(empty);
  const edited = tree.linksFor("al");
  tree.apply({ type: "setTitle", title: "Renamed" });
  tree.apply({ type: "setText", id: "bl", text: "changed target" });
  expect(tree.linksFor("al")).toBe(edited);
  expect(tree.linksFor("ar")).toBe(right);
  expect(Object.isFrozen(edited)).toBe(true);
});

it("updates source groups for compound removal and snapshot restoration", () => {
  const tree = notebook();
  const before = tree.schema;
  tree.applyMany([
    { type: "setLinks", links: [] },
    { type: "removeContainer", id: "b" },
  ]);
  expect(tree.linksFor("al")).toEqual([]);
  expect(tree.linksFor("ar")).toEqual([]);
  tree.restore({ ...before });
  expect(tree.linksFor("al")).toEqual([before.links![0]]);
  expect(tree.linksFor("ar")).toEqual([before.links![1]]);
});

it("does not publish link changes from rejected edits or compound actions", () => {
  const tree = notebook();
  const before = tree.linksFor("al");
  expect(() => tree.setTextAndLinks("al", "x", tree.schema.links!)).toThrow();
  expect(tree.linksFor("al")).toBe(before);
  expect(() =>
    tree.applyMany([
      { type: "setLinks", links: [] },
      { type: "setText", id: "missing", text: "invalid" },
    ]),
  ).toThrow();
  expect(tree.linksFor("al")).toBe(before);
});
