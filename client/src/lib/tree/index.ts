import type { Container, Schema } from "../../schema.js";

export type IndexEntry = Readonly<{
  container: Container;
  parentId: string | null;
  index: number;
  side: "container" | "left" | "right";
}>;
export type TreeIndex = ReadonlyMap<string, IndexEntry>;

/** Prune all removed branches before installing moved branches in their new positions. */
export function updateIndex(
  index: Map<string, IndexEntry>,
  before: readonly Container[],
  after: readonly Container[],
  parentId: string | null = null,
): void {
  function remove(row: Container) {
    index.delete(row.id);
    for (const content of row.left) index.delete(content.id);
    index.delete(row.right.id);
    row.right.children.forEach(remove);
  }
  function prune(oldRows: readonly Container[], newRows: readonly Container[]) {
    const next = new Map(newRows.map((row) => [row.id, row]));
    for (const row of oldRows) {
      const replacement = next.get(row.id);
      if (!replacement) remove(row);
      else if (replacement !== row) {
        const contents = new Set([
          ...replacement.left.map((content) => content.id),
          replacement.right.id,
        ]);
        for (const content of [...row.left, row.right])
          if (!contents.has(content.id)) index.delete(content.id);
        prune(row.right.children, replacement.right.children);
      }
    }
  }
  function install(
    oldRows: readonly Container[],
    newRows: readonly Container[],
    parent: string | null,
  ) {
    const previous = new Map(oldRows.map((row) => [row.id, row]));
    newRows.forEach((row, position) => {
      const old = previous.get(row.id),
        entry = index.get(row.id);
      if (old === row && entry?.parentId === parent && entry.index === position) return;
      index.set(
        row.id,
        Object.freeze({ container: row, parentId: parent, index: position, side: "container" }),
      );
      row.left.forEach((content, contentIndex) =>
        index.set(
          content.id,
          Object.freeze({
            container: row,
            parentId: parent,
            index: contentIndex,
            side: "left",
          }),
        ),
      );
      index.set(
        row.right.id,
        Object.freeze({ container: row, parentId: parent, index: 0, side: "right" }),
      );
      install(old?.right.children ?? [], row.right.children, row.id);
    });
  }
  prune(before, after);
  install(before, after, parentId);
}
export function buildIndex(schema: Schema): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();
  updateIndex(index, [], schema.root);
  return index;
}

/** Expose live lookups without leaking the mutable map, including through forEach. */
export function readonlyIndex(index: Map<string, IndexEntry>): TreeIndex {
  const view: TreeIndex = Object.freeze({
    get size() {
      return index.size;
    },
    get: (id: string) => index.get(id),
    has: (id: string) => index.has(id),
    entries: () => index.entries(),
    keys: () => index.keys(),
    values: () => index.values(),
    [Symbol.iterator]: () => index[Symbol.iterator](),
    forEach(callback: (value: IndexEntry, key: string, map: TreeIndex) => void, thisArg?: unknown) {
      index.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  });
  return view;
}
