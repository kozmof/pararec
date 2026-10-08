import type { Caret } from "./document-store.svelte.js";
import type { StructureCommand } from "../tree/structure.js";
import type { CaretAffinity } from "./line-measurer.js";
import type { ContentCache } from "./content-cache.js";
export type Entry =
  | { kind: "caret"; line: number; column: number; affinity?: CaretAffinity }
  | { kind: "edge"; edge: "start" | "end"; goalX?: number };
export type Boundary = "up" | "down" | "left" | "right";
export type Command =
  | StructureCommand
  | "otherColumnLeft"
  | "otherColumnRight"
  | "enter"
  | "leave"
  | "save"
  | "undo"
  | "redo";
export interface ContentHost {
  readonly focused: string | null;
  readonly cache: ContentCache;
  readonly entry: Entry;
  readonly disabled: boolean;
  focus(id: string, entry?: Entry): void;
  blur(id: string): void;
  boundary(direction: Boundary, goalX: number): void;
  command(command: Command, caret?: Caret): void;
  caret(id: string, caret: Caret): void;
}
export const CONTENT_HOST = Symbol("content-host");
