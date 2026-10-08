import { parseSchema, type Schema } from "../../schema.js";
import { buildIndex, updateIndex } from "./index.js";
import { applyOp, type Op } from "./ops.js";

export class TreeStore {
  #schema = $state.raw<Schema>();
  #revision = $state(0);
  readonly index;
  constructor(value: unknown) {
    this.#schema = parseSchema(value);
    this.index = buildIndex(this.#schema);
  }
  get schema(): Schema {
    return this.#schema!;
  }
  get revision(): number {
    return this.#revision;
  }
  apply(op: Op): Op {
    const before = this.schema;
    const result = applyOp(before, op, this.index);
    updateIndex(this.index, before.root, result.schema.root);
    this.#schema = result.schema;
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
    updateIndex(this.index, before.root, staged.root);
    this.#schema = staged;
    this.#revision++;
    return inverses;
  }
}
