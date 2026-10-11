import { parseSchema, type Schema } from "../../schema.js";
import { buildIndex, updateIndex, readonlyIndex } from "./index.js";
import { applyOp, type Op } from "./ops.js";

export class TreeStore {
  #schema = $state.raw<Schema>();
  #revision = $state(0);
  #validated = new WeakSet<Schema>();
  readonly #index;
  readonly index;
  constructor(value: unknown) {
    this.#schema = parseSchema(value);
    this.#validated.add(this.#schema);
    this.#index = buildIndex(this.#schema);
    this.index = readonlyIndex(this.#index);
    freezeSnapshot(this.#schema);
  }
  get schema(): Schema {
    return this.#schema!;
  }
  get revision(): number {
    return this.#revision;
  }
  /** Restore a previously validated immutable app snapshot and rebuild its index. */
  restore(schema: Schema): void {
    if (!this.#validated.has(schema)) {
      schema = parseSchema(schema);
      freezeSnapshot(schema);
      this.#validated.add(schema);
    }
    const index = buildIndex(schema);
    this.#index.clear();
    for (const [id, entry] of index) this.#index.set(id, entry);
    this.#schema = schema;
    this.#revision++;
  }
  apply(op: Op): Op {
    const before = this.schema;
    const result = applyOp(before, op, this.index);
    updateIndex(this.#index, before.root, result.schema.root);
    freezeSnapshot(result.schema);
    this.#schema = result.schema;
    this.#validated.add(result.schema);
    this.#revision++;
    return result.inverse;
  }
  /** Validate every step before publishing a compound structure action once. */
  applyMany(ops: Op[]): Op[] {
    if (!ops.length) return [];
    const before = this.schema;
    let staged = before;
    const stagedIndex = new Map(this.index);
    const inverses: Op[] = [];
    for (const op of ops) {
      const result = applyOp(staged, op, stagedIndex);
      updateIndex(stagedIndex, staged.root, result.schema.root);
      staged = result.schema;
      inverses.unshift(result.inverse);
    }
    updateIndex(this.#index, before.root, staged.root);
    freezeSnapshot(staged);
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
