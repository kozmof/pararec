import type { Container, Content } from "../../schema.js";
import type { TreeIndex } from "./index.js";

const emptyRows: readonly Container[] = Object.freeze([]);

class RightView implements Content {
  #content = $state.raw<Content>();
  #children = $state.raw<readonly Container[]>(emptyRows);
  constructor(content: Content, children: readonly Container[]) {
    this.update(content, children);
  }
  get id() {
    return this.#content!.id;
  }
  get text() {
    return this.#content!.text;
  }
  get renderType() {
    return this.#content!.renderType;
  }
  get children() {
    return this.#children;
  }
  update(content: Content, children: readonly Container[]) {
    this.#content = content;
    this.#children = children;
  }
}

class RowView implements Container {
  readonly id: string;
  readonly right: RightView;
  #left = $state.raw<readonly Content[]>([]);
  #snapshot: Container;
  constructor(row: Container, children: readonly Container[]) {
    this.id = row.id;
    this.right = new RightView(row.right, children);
    this.#left = row.left;
    this.#snapshot = row;
  }
  get left() {
    return this.#left;
  }
  get snapshot() {
    return this.#snapshot;
  }
  update(row: Container, children: readonly Container[]) {
    this.#left = row.left;
    this.right.update(row.right, children);
    this.#snapshot = row;
  }
}

/** Keep UI lists stable during text edits while persisted snapshots stay immutable. */
export class TreeView {
  #root = $state.raw<readonly Container[]>(emptyRows);
  #snapshot: readonly Container[] = emptyRows;
  #rows = new Map<string, RowView>();
  #structureChanged = false;
  constructor(rows: readonly Container[]) {
    this.update(rows);
  }
  row(id: string): Container | undefined {
    return this.#rows.get(id);
  }
  rowsAt(path: readonly string[]): readonly Container[] {
    let rows = this.#root;
    for (const id of path) {
      const row = rows.find((row) => row.id === id);
      if (!row) break;
      rows = row.right.children;
    }
    return rows;
  }
  update(rows: readonly Container[], index?: TreeIndex): void {
    this.#structureChanged = false;
    this.#root = this.#project(rows, this.#snapshot, this.#root);
    this.#snapshot = rows;
    if (this.#structureChanged && index) {
      for (const id of this.#rows.keys())
        if (index.get(id)?.side !== "container") this.#rows.delete(id);
    }
  }
  /** Text edits preserve row order and child view lists. */
  updateText(rows: readonly Container[], changed: readonly Container[]): void {
    for (const row of changed) {
      const view = this.#rows.get(row.id)!;
      view.update(row, view.right.children);
    }
    this.#snapshot = rows;
  }
  #project(
    rows: readonly Container[],
    before: readonly Container[],
    previous: readonly Container[],
  ): readonly Container[] {
    if (rows === before) return previous;
    let sameOrder = rows.length === previous.length;
    const next = rows.map((row, at) => {
      let view = this.#rows.get(row.id);
      if (!view) {
        const children = this.#project(row.right.children, emptyRows, emptyRows);
        view = new RowView(row, children);
        this.#rows.set(row.id, view);
      } else if (view.snapshot !== row) {
        const children = this.#project(
          row.right.children,
          view.snapshot.right.children,
          view.right.children,
        );
        view.update(row, children);
      }
      sameOrder &&= view === previous[at];
      return view;
    });
    if (sameOrder) return previous;
    this.#structureChanged = true;
    return Object.freeze(next);
  }
}
