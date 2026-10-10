import type { Container, Schema } from "../../schema.js";
import type { TreeIndex } from "./index.js";

export function layerDepth(schema: Schema): number {
  let depth = 1;
  const pending = [{ rows: schema.root, depth: 1 }];
  while (pending.length) {
    const level = pending.pop()!;
    for (const row of level.rows) {
      if (!row.right.children.length) continue;
      const childDepth = level.depth + 1;
      depth = Math.max(depth, childDepth);
      pending.push({ rows: row.right.children, depth: childDepth });
    }
  }
  return depth;
}

export function validPath(schema: Schema, path: string[]): string[] {
  const valid: string[] = [];
  let rows = schema.root;
  for (const id of path) {
    const row = rows.find((row) => row.id === id);
    if (!row) break;
    valid.push(id);
    rows = row.right.children;
  }
  return valid;
}
export function pathFromHash(hash: string): string[] {
  if (!hash.startsWith("#/c/")) return [];
  const result: string[] = [];
  for (const part of hash.slice(4).split("/")) {
    try {
      result.push(decodeURIComponent(part));
    } catch {
      break;
    }
  }
  return result;
}
export function pathHash(path: string[]): string {
  return path.length ? `#/c/${path.map(encodeURIComponent).join("/")}` : "#/";
}
export function containerPath(index: TreeIndex, id: string): string[] {
  const path: string[] = [];
  let current: string | null = id;
  while (current !== null) {
    const entry = index.get(current);
    if (!entry || entry.side !== "container") throw new Error("Unknown Container");
    path.unshift(current);
    current = entry.parentId;
  }
  return path;
}
export function levelAt(schema: Schema, path: string[]): Container[] {
  let rows = schema.root;
  for (const id of validPath(schema, path))
    rows = rows.find((row) => row.id === id)!.right.children;
  return rows;
}
