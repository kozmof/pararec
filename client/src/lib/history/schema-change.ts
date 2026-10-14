import type { Schema } from "../../schema.js";

type Segment = string | number | { id: string };
type Path = readonly Segment[];
type ValueChange = { kind: "value"; path: Path; before: unknown; after: unknown };
type OrderChange = {
  kind: "order";
  path: Path;
  before: string[];
  after: string[];
  removed: readonly Identified[];
  inserted: readonly Identified[];
};
type Identified = { id: string };
export type SchemaChange = ValueChange | OrderChange;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function identified(values: readonly unknown[]): values is readonly Identified[] {
  return values.every((value) => object(value) && typeof value.id === "string");
}

/** Retain changed values and row order, rather than two complete document snapshots. */
export function schemaChanges(before: Schema, after: Schema): SchemaChange[] {
  const changes: SchemaChange[] = [];
  function visit(a: unknown, b: unknown, path: Path): void {
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b) && identified(a) && identified(b)) {
      const previous = new Map(a.map((value) => [value.id, value]));
      const next = new Map(b.map((value) => [value.id, value]));
      if (a.length !== b.length || a.some((value, index) => value.id !== b[index].id)) {
        changes.push({
          kind: "order",
          path,
          before: a.map((value) => value.id),
          after: b.map((value) => value.id),
          removed: a.filter((value) => !next.has(value.id)),
          inserted: b.filter((value) => !previous.has(value.id)),
        });
      }
      for (const value of b) {
        if (previous.has(value.id))
          visit(previous.get(value.id), value, [...path, { id: value.id }]);
      }
    } else if (object(a) && object(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        visit(a[key], b[key], [...path, key]);
    } else {
      changes.push({ kind: "value", path, before: a, after: b });
    }
  }
  visit(before, after, []);
  return changes;
}

function replace(value: unknown, path: Path, update: (current: unknown) => unknown): unknown {
  if (!path.length) return update(value);
  const [segment, ...rest] = path;
  if (Array.isArray(value)) {
    const index =
      typeof segment === "object"
        ? value.findIndex((item) => item.id === segment.id)
        : Number(segment);
    if (index < 0 || index >= value.length) throw new Error("Unknown history item");
    const result = value.slice();
    result[index] = replace(value[index], rest, update);
    return result;
  }
  if (!object(value) || typeof segment !== "string") throw new Error("Invalid history path");
  const result = { ...value };
  const next = replace(value[segment], rest, update);
  if (next === undefined) delete result[segment];
  else result[segment] = next;
  return result;
}

/** Rebuild only affected ancestors, preserving unchanged branches by reference. */
export function applySchemaChanges(
  schema: Schema,
  changes: readonly SchemaChange[],
  undo: boolean,
): Schema {
  let result: unknown = schema;
  for (const change of undo ? [...changes].reverse() : changes) {
    result = replace(result, change.path, (current) => {
      if (change.kind === "value") return undo ? change.before : change.after;
      const values = new Map((current as Identified[]).map((value) => [value.id, value]));
      for (const value of undo ? change.removed : change.inserted) values.set(value.id, value);
      return (undo ? change.before : change.after).map((id) => {
        const value = values.get(id);
        if (!value) throw new Error("Unknown history item");
        return value;
      });
    });
  }
  return result as Schema;
}
