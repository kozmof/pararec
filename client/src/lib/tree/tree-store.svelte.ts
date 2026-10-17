import { parseSchema, validateLinks, type Schema, type Container } from "../../schema.js";
import { buildIndex, updateIndex, readonlyIndex, type TreeIndex } from "./index.js";
import { applyOp, type Op } from "./ops.js";
import { LinkIndex } from "./link-index.js";

export class TreeStore {
  #schema = $state.raw<Schema>();
  #revision = $state(0);
  #validated = new WeakSet<Schema>();
  readonly #links = new LinkIndex();
  readonly #index;
  readonly index;
  constructor(value: unknown) {
    this.#schema = parseSchema(value);
    this.#validated.add(this.#schema);
    this.#index = buildIndex(this.#schema);
    this.index = readonlyIndex(this.#index);
    freezeSnapshot(this.#schema);
    this.#links.update(this.#schema.links);
  }
  get schema(): Schema {
    return this.#schema!;
  }
  linksFor(id: string) {
    return this.#links.forSource(id);
  }
  get revision(): number {
    return this.#revision;
  }
  /** Restore an app snapshot and update only changed index branches. */
  restore(schema: Schema): void {
    if (!this.#validated.has(schema)) {
      const emptyLinks = schema.links?.length === 0;
      const parsed = parseSchema(schema);
      schema = { ...parsed, root: reuseFrozenRows(parsed.root, schema.root) };
      // Reconstructed history snapshots can contain an explicitly emptied link list.
      if (emptyLinks) schema = { ...schema, links: [] };
      freezeSnapshot(schema);
      this.#validated.add(schema);
    }
    updateIndex(this.#index, this.schema.root, schema.root);
    this.#links.update(schema.links);
    this.#schema = schema;
    this.#revision++;
  }
  apply(op: Op): Op {
    const before = this.schema;
    const result = applyOp(before, op, this.index);
    // Title changes and text in unrelated sources preserve existing link invariants.
    if (
      op.type !== "setTitle" &&
      !(op.type === "setText" && !before.links?.some((link) => link.sourceId === op.id))
    )
      validateLinks(
        result.schema,
        op.type === "setText"
          ? (id) =>
              id === op.id
                ? op.normalized
                  ? op.text
                  : op.text.replace(/\r\n?/g, "\n")
                : indexedText(this.index, id)
          : undefined,
      );
    updateIndex(this.#index, before.root, result.schema.root);
    freezeSnapshot(result.schema);
    this.#links.update(result.schema.links);
    this.#schema = result.schema;
    this.#validated.add(result.schema);
    this.#revision++;
    return result.inverse;
  }
  /** Publish edited text and its resolved links without cloning the tree index. */
  setTextAndLinks(id: string, text: string, links: NonNullable<Schema["links"]>): void {
    const before = this.schema;
    const edited = applyOp(
      before,
      { type: "setText", id, text, normalized: true },
      this.index,
      false,
    );
    const next = applyOp(edited.schema, { type: "setLinks", links }, this.index, false).schema;
    validateLinks(next, (contentId) =>
      contentId === id ? text : indexedText(this.index, contentId),
    );
    freezeSnapshot(next);
    updateIndex(this.#index, before.root, next.root);
    this.#links.update(next.links);
    this.#schema = next;
    this.#validated.add(next);
    this.#revision++;
  }
  /** Validate every step before publishing a compound structure action once. */
  applyMany(ops: Op[]): Op[] {
    if (!ops.length) return [];
    const before = this.schema;
    let staged = before;
    const stagedIndex = new Map(this.index);
    const inverses: Op[] = [];
    for (const op of ops) {
      const result = applyOp(staged, op, stagedIndex, false);
      updateIndex(stagedIndex, staged.root, result.schema.root);
      staged = result.schema;
      inverses.unshift(result.inverse);
    }
    validateLinks(staged, (id) => indexedText(stagedIndex, id));
    updateIndex(this.#index, before.root, staged.root);
    freezeSnapshot(staged);
    this.#links.update(staged.links);
    this.#schema = staged;
    this.#validated.add(staged);
    this.#revision++;
    return inverses;
  }
}

// Shared branches are visited once, so a text edit only freezes its new objects.
const frozen = new WeakSet<object>();
function freezeSnapshot(value: object): void {
  if (frozen.has(value)) return;
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") freezeSnapshot(child);
  }
  Object.freeze(value);
  frozen.add(value);
}

function indexedText(index: TreeIndex, id: string): string | undefined {
  const entry = index.get(id);
  if (!entry || entry.side === "container") return undefined;
  return entry.side === "right"
    ? entry.container.right.text
    : entry.container.left[entry.index].text;
}

// Parsing still checks all global invariants. Reuse only branches previously frozen by
// this module, so history restores retain structural sharing without trusting caller data.
function reuseFrozenRows(
  parsed: readonly Container[],
  source: readonly Container[],
): readonly Container[] {
  if (frozen.has(source)) return source;
  return parsed.map((row, index) => {
    const original = source[index];
    if (frozen.has(original)) return original;
    return {
      ...row,
      left: frozen.has(original.left)
        ? original.left
        : row.left.map((cell, at) => (frozen.has(original.left[at]) ? original.left[at] : cell)),
      right: frozen.has(original.right)
        ? original.right
        : {
            ...row.right,
            children: reuseFrozenRows(row.right.children, original.right.children),
          },
    };
  });
}
