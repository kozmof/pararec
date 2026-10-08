import type { TreeStore } from "../tree/tree-store.svelte.js";
import type { Schema } from "../../schema.js";
import { EditorDocument, type DocumentEdit } from "./document-store.svelte.js";
export type ContentChange = { contentId: string; before: Schema; after: Schema } & Pick<
  DocumentEdit,
  "beforeCaret" | "afterCaret" | "kind" | "group" | "intent" | "groupable"
>;
export class ContentCache {
  #stores = new Map<string, EditorDocument>();
  constructor(
    private tree: TreeStore,
    private changed: (edit?: ContentChange) => void,
    private limit = 50,
  ) {}
  get size() {
    return this.#stores.size;
  }
  get(id: string): EditorDocument {
    const entry = this.tree.index.get(id);
    if (!entry || entry.side === "container") throw new Error("Unknown Content");
    const text =
      entry.side === "right" ? entry.container.right.text : entry.container.left[entry.index].text;
    let doc = this.#stores.get(id);
    if (doc && doc.text() !== text) {
      doc.dispose();
      this.#stores.delete(id);
      doc = undefined;
    }
    if (!doc) {
      doc = new EditorDocument(text);
      const current = doc;
      doc.subscribeEdits((edit) => {
        if (this.#stores.get(id) !== current || !this.tree.index.has(id)) return;
        const before = this.tree.schema;
        this.tree.apply({ type: "setText", id, text: current.text() });
        this.changed({
          contentId: id,
          before,
          after: this.tree.schema,
          beforeCaret: edit.beforeCaret,
          afterCaret: edit.afterCaret,
          kind: edit.kind,
          group: edit.group,
          intent: edit.intent,
          groupable: edit.groupable,
        });
      });
    }
    this.#stores.delete(id);
    this.#stores.set(id, doc);
    while (this.#stores.size > this.limit) {
      const oldest = this.#stores.keys().next().value!;
      this.#stores.get(oldest)!.dispose();
      this.#stores.delete(oldest);
    }
    return doc;
  }
  prune() {
    for (const [id, doc] of this.#stores)
      if (!this.tree.index.has(id)) {
        doc.dispose();
        this.#stores.delete(id);
      }
  }
  dispose() {
    for (const doc of this.#stores.values()) doc.dispose();
    this.#stores.clear();
  }
}
