import { parseSchema, type Container, type Content, type Schema } from "../../schema.js";
import { buildIndex, type TreeIndex } from "./index.js";

function spliced<T>(items: T[], at: number, count: number, ...insert: T[]): T[] {
  const result = items.slice();
  result.splice(at, count, ...insert);
  return result;
}

export type Op =
  | { type: "insertContainer"; parentId: string | null; index: number; container: Container }
  // An insertion's inverse can remove its unchanged subtree. User removal omits expected.
  | { type: "removeContainer"; id: string; expected?: Container }
  | { type: "moveContainer"; id: string; parentId: string | null; index: number }
  | { type: "insertContent"; containerId: string; index: number; content: Content }
  | { type: "removeContent"; id: string }
  | { type: "moveContent"; id: string; containerId: string; index: number }
  | { type: "setText"; id: string; text: string };

/** Positions for moves refer to the destination after removing the source. */
export function applyOp(
  schema: Schema,
  op: Op,
  index: TreeIndex = buildIndex(schema),
): { schema: Schema; inverse: Op } {
  function row(id: string): Container {
    const entry = index.get(id);
    if (!entry || entry.side !== "container") throw new Error("Unknown Container");
    return entry.container;
  }
  function left(id: string) {
    const entry = index.get(id);
    if (!entry || entry.side !== "left") throw new Error("Expected a left Content");
    return entry;
  }
  function level(parentId: string | null) {
    return parentId === null ? schema.root : row(parentId).right.children;
  }
  function position(at: number, length: number) {
    if (!Number.isInteger(at) || at < 0 || at > length) throw new Error("Invalid position");
  }
  function fresh(ids: Iterable<string>) {
    for (const id of ids) if (index.has(id)) throw new Error("Duplicate id");
  }
  // Rebuild only the changed row and its ancestors using the existing parent index.
  function replaceRow(tree: Schema, id: string, next: Container): Schema {
    const entry = index.get(id)!;
    return replaceLevel(tree, entry.parentId, (rows) =>
      rows.map((item) => (item.id === id ? next : item)),
    );
  }
  function replaceLevel(
    tree: Schema,
    parentId: string | null,
    change: (rows: Container[]) => Container[],
  ): Schema {
    if (parentId === null) return { ...tree, root: change(tree.root) };
    const entry = index.get(parentId)!;
    // An earlier move may already have changed this ancestor in the intermediate tree.
    const chain: string[] = [];
    let current: string | null = parentId;
    while (current !== null) {
      chain.unshift(current);
      current = index.get(current)!.parentId;
    }
    let rows = tree.root;
    let parent = entry.container;
    for (const id of chain) {
      parent = rows.find((item) => item.id === id)!;
      rows = parent.right.children;
    }
    return replaceRow(tree, parentId, {
      ...parent,
      right: { ...parent.right, children: change(rows) },
    });
  }
  switch (op.type) {
    case "insertContainer": {
      position(op.index, level(op.parentId).length);
      const container = parseSchema({ version: 1, root: [op.container] }).root[0];
      fresh(buildIndex({ version: 1, root: [container] }).keys());
      return {
        schema: replaceLevel(schema, op.parentId, (rows) => spliced(rows, op.index, 0, container)),
        inverse: { type: "removeContainer", id: container.id, expected: container },
      };
    }
    case "removeContainer": {
      const container = row(op.id),
        entry = index.get(op.id)!;
      if (
        container.right.children.length &&
        (!op.expected || JSON.stringify(op.expected) !== JSON.stringify(container))
      )
        throw new Error("Cannot remove a Container with children");
      return {
        schema: replaceLevel(schema, entry.parentId, (rows) =>
          rows.filter((item) => item.id !== op.id),
        ),
        inverse: {
          type: "insertContainer",
          parentId: entry.parentId,
          index: entry.index,
          container,
        },
      };
    }
    case "moveContainer": {
      const container = row(op.id),
        entry = index.get(op.id)!;
      let parent = op.parentId;
      if (parent !== null) row(parent);
      while (parent !== null) {
        if (parent === op.id)
          throw new Error("Cannot move a Container into itself or its descendants");
        parent = index.get(parent)!.parentId;
      }
      position(op.index, level(op.parentId).length - (entry.parentId === op.parentId ? 1 : 0));
      const removed = replaceLevel(schema, entry.parentId, (rows) =>
        rows.filter((item) => item.id !== op.id),
      );
      return {
        schema: replaceLevel(removed, op.parentId, (rows) => spliced(rows, op.index, 0, container)),
        inverse: { type: "moveContainer", id: op.id, parentId: entry.parentId, index: entry.index },
      };
    }
    case "insertContent": {
      const container = row(op.containerId);
      position(op.index, container.left.length);
      if (typeof op.content.id !== "string" || typeof op.content.text !== "string")
        throw new Error("Invalid Content");
      fresh([op.content.id]);
      const content = { id: op.content.id, text: op.content.text.replace(/\r\n?/g, "\n") };
      return {
        schema: replaceRow(schema, container.id, {
          ...container,
          left: spliced(container.left, op.index, 0, content),
        }),
        inverse: { type: "removeContent", id: content.id },
      };
    }
    case "removeContent": {
      const entry = left(op.id),
        container = entry.container;
      if (container.left.length === 1) throw new Error("Cannot remove the last left Content");
      return {
        schema: replaceRow(schema, container.id, {
          ...container,
          left: spliced(container.left, entry.index, 1),
        }),
        inverse: {
          type: "insertContent",
          containerId: container.id,
          index: entry.index,
          content: container.left[entry.index],
        },
      };
    }
    case "moveContent": {
      const entry = left(op.id),
        source = entry.container,
        target = row(op.containerId);
      if (source.id !== target.id && source.left.length === 1)
        throw new Error("Cannot move the last left Content to another Container");
      position(op.index, target.left.length - (source.id === target.id ? 1 : 0));
      const content = source.left[entry.index];
      const remaining = spliced(source.left, entry.index, 1);
      let next = replaceRow(schema, source.id, { ...source, left: remaining });
      // Read the target from the updated tree when source and target have a common ancestor.
      next = replaceLevel(next, index.get(target.id)!.parentId, (rows) =>
        rows.map((item) =>
          item.id === target.id
            ? {
                ...item,
                left: spliced(
                  source.id === target.id ? remaining : item.left,
                  op.index,
                  0,
                  content,
                ),
              }
            : item,
        ),
      );
      return {
        schema: next,
        inverse: { type: "moveContent", id: op.id, containerId: source.id, index: entry.index },
      };
    }
    case "setText": {
      const entry = index.get(op.id);
      if (!entry || entry.side === "container") throw new Error("Unknown Content");
      if (typeof op.text !== "string") throw new Error("Expected string text");
      const container = entry.container;
      const previous = entry.side === "left" ? container.left[entry.index] : container.right;
      const text = op.text.replace(/\r\n?/g, "\n");
      const next =
        entry.side === "left"
          ? {
              ...container,
              left: container.left.map((content) =>
                content.id === op.id ? { ...content, text } : content,
              ),
            }
          : { ...container, right: { ...container.right, text } };
      return {
        schema: replaceRow(schema, container.id, next),
        inverse: { type: "setText", id: op.id, text: previous.text },
      };
    }
  }
}

export function createContainer(): Container {
  return {
    id: crypto.randomUUID(),
    left: [{ id: crypto.randomUUID(), text: "" }],
    right: { id: crypto.randomUUID(), text: "", children: [] },
  };
}
