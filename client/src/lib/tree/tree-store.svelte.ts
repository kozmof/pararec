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
}
