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
  | "focusLeft"
  | "focusRight"
  | "focusUp"
  | "focusDown"
  | "save"
  | "undo"
  | "redo";
export interface ContentHost {
  readonly renderType?: string;
  renderMenu?(id: string, event: MouseEvent): void;
  readonly linking?: boolean;
  readonly links?: readonly import("../../schema.js").TextLink[];
  selectedCell?(id: string): boolean;
  selectCell?(id: string): void;
  linkMenu?(id: string, range: { start: number; end: number }, event: MouseEvent): void;
  labelMenu?(sourceId: string, ids: readonly string[], event: MouseEvent): void;
  followLink?(id: string): void;
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
