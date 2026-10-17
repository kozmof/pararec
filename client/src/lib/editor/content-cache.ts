import type { TreeStore } from "../tree/tree-store.svelte.js";
import type { Schema } from "../../schema.js";
import { EditorDocument, type DocumentEdit } from "./document-store.svelte.js";
import { query, rendering, type DocumentState } from "@kozmof/reed";
import type { TextChange, TextPatch } from "../history/history.svelte.js";
function span(state: DocumentState, from: number, to: number): string {
  if (from === to) return "";
  const start = query.findLineAtCharPosition(state, from)!;
  const end = query.findLineAtCharPosition(state, to)!;
  const lines: string[] = [];
  for (let line = start.lineNumber; line <= end.lineNumber; line++) {
    const text = rendering.getLineContent(state, line) ?? "";
    lines.push(
      text.slice(
        line === start.lineNumber ? start.charOffsetInLine : 0,
        line === end.lineNumber ? end.charOffsetInLine : undefined,
      ),
    );
  }
  return lines.join("\n");
}
export type ContentChange = {
  contentId: string;
  before: Schema;
  after: Schema;
  textChange: TextChange;
  textPatch: TextPatch;
} & Pick<DocumentEdit, "beforeCaret" | "afterCaret" | "kind" | "group" | "intent" | "groupable">;
export class ContentCache {
  #stores = new Map<string, EditorDocument>();
  #owners = new Map<string, Set<object>>();
  #restoring = false;
  constructor(
    private tree: TreeStore,
    private changed: (edit?: ContentChange) => void,
    private limit = 50,
  ) {}
  get size() {
    return this.#stores.size;
  }
  get(id: string, owner?: object): EditorDocument {
    const entry = this.tree.index.get(id);
    if (!entry || entry.side === "container") throw new Error("Unknown Content");
    if (owner) {
      let owners = this.#owners.get(id);
      if (!owners) this.#owners.set(id, (owners = new Set()));
      owners.add(owner);
    }
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
        if (this.#restoring || this.#stores.get(id) !== current || !this.tree.index.has(id)) return;
        const before = this.tree.schema;
        const entry = this.tree.index.get(id)!;
        const beforeText =
          entry.side === "right"
            ? entry.container.right.text
            : entry.container.left[entry.index].text;
        const text = current.text();
        const { fromLine, oldEndLine, newEndLine } = edit.change;
        const textChange: TextChange = {
          contentId: id,
          from: Math.min(
            query.getCharStartOffset(edit.before, fromLine),
            query.getCharStartOffset(edit.after, fromLine),
          ),
          oldEnd:
            oldEndLine < query.getLineCount(edit.before)
              ? query.getCharStartOffset(edit.before, oldEndLine)
              : beforeText.length,
          newEnd:
            newEndLine < query.getLineCount(edit.after)
              ? query.getCharStartOffset(edit.after, newEndLine)
              : text.length,
        };
        if (before.links?.some((link) => link.sourceId === id)) {
          this.tree.setTextAndLinks(id, text, [
            ...before.links.filter((link) => link.sourceId !== id),
            ...current.resolvedLinks(),
          ]);
        } else this.tree.apply({ type: "setText", id, text, normalized: true });
        this.changed({
          contentId: id,
          before,
          after: this.tree.schema,
          textChange,
          textPatch: {
            removed: span(edit.before, textChange.from, textChange.oldEnd),
            inserted: span(edit.after, textChange.from, textChange.newEnd),
          },
          beforeCaret: edit.beforeCaret,
          afterCaret: edit.afterCaret,
          kind: edit.kind,
          group: edit.group,
          intent: edit.intent,
          groupable: edit.groupable,
        });
      });
    }
    doc.syncLinks((this.tree.schema.links ?? []).filter((link) => link.sourceId === id));
    this.#stores.delete(id);
    this.#stores.set(id, doc);
    this.#evict();
    return doc;
  }
  release(id: string, owner: object): void {
    const owners = this.#owners.get(id);
    owners?.delete(owner);
    if (!owners?.size) this.#owners.delete(id);
    this.#evict();
  }
  // Mounted views own their stores. The limit applies to idle stores only.
  #evict(): void {
    let idle = this.#stores.size - this.#owners.size;
    for (const [id, doc] of this.#stores) {
      if (idle <= this.limit) break;
      if (this.#owners.has(id)) continue;
      doc.dispose();
      this.#stores.delete(id);
      idle--;
    }
  }
  restoreText(change: TextChange | undefined, previousText: string | undefined): boolean {
    if (!change) return false;
    const doc = this.#stores.get(change.contentId);
    const entry = this.tree.index.get(change.contentId);
    if (!doc || !entry || entry.side === "container" || doc.text() !== previousText) return false;
    const text =
      entry.side === "right" ? entry.container.right.text : entry.container.left[entry.index].text;
    this.#restoring = true;
    try {
      doc.restoreText(text, change.from, change.oldEnd, change.newEnd);
    } finally {
      this.#restoring = false;
    }
    return true;
  }
  prune() {
    for (const [id, doc] of this.#stores)
      if (!this.tree.index.has(id)) {
        doc.dispose();
        this.#stores.delete(id);
        this.#owners.delete(id);
      }
  }
  dispose() {
    for (const doc of this.#stores.values()) doc.dispose();
    this.#stores.clear();
    this.#owners.clear();
  }
}
