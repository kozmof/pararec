import type { Container, Schema } from "../../schema.js";

export type IndexEntry = {
  container: Container;
  parentId: string | null;
  index: number;
  side: "container" | "left" | "right";
};
export type TreeIndex = Map<string, IndexEntry>;

/** Prune all removed branches before installing moved branches in their new positions. */
export function updateIndex(
  index: TreeIndex,
  before: Container[],
  after: Container[],
  parentId: string | null = null,
): void {
  function remove(row: Container) {
    index.delete(row.id);
    for (const content of row.left) index.delete(content.id);
    index.delete(row.right.id);
    row.right.children.forEach(remove);
  }
  function prune(oldRows: Container[], newRows: Container[]) {
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
  function install(oldRows: Container[], newRows: Container[], parent: string | null) {
    const previous = new Map(oldRows.map((row) => [row.id, row]));
    newRows.forEach((row, position) => {
      const old = previous.get(row.id),
        entry = index.get(row.id);
      if (old === row && entry?.parentId === parent && entry.index === position) return;
      index.set(row.id, { container: row, parentId: parent, index: position, side: "container" });
      row.left.forEach((content, contentIndex) =>
        index.set(content.id, {
          container: row,
          parentId: parent,
          index: contentIndex,
          side: "left",
        }),
      );
      index.set(row.right.id, { container: row, parentId: parent, index: 0, side: "right" });
      install(old?.right.children ?? [], row.right.children, row.id);
    });
  }
  prune(before, after);
  install(before, after, parentId);
}
export function buildIndex(schema: Schema): TreeIndex {
  const index: TreeIndex = new Map();
  updateIndex(index, [], schema.root);
  return index;
}
