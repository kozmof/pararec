<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { position, rendering } from "@kozmof/reed";
  import type { TextLink } from "../schema.js";
  import type { InlineDecoration } from "../lib/editor/inline-rendering.js";
  import EditorSurface from "../lib/editor/EditorSurface.svelte";
  import { orderCarets, type EditorDocument, type Caret } from "../lib/editor/document-store.svelte.js";
  import type { Entry, Boundary, Command } from "../lib/editor/content-host.js";
  let { links = [], onDestination, annotationsDisabled = false, doc, active = true, entry, onBoundary, onCommand, onKeydown, onHeight, onCaret, initialMeasurements, side }: { links?: readonly TextLink[]; onDestination?: (id: string) => void; annotationsDisabled?: boolean; doc: EditorDocument; active?: boolean; entry: Entry; side: "left" | "right"; onBoundary: (direction: Boundary, goalX: number) => void; onCommand: (command: Command, caret?: Caret) => void; onKeydown?: (event: KeyboardEvent) => boolean; onHeight?: (height: number) => void; onCaret?: (caret: Caret) => void; initialMeasurements?: { width: number; heights: number[] } } = $props();
  const emptyDecorations: InlineDecoration[] = [];
  const decorations = $derived.by((): InlineDecoration[] => links.length ? links.flatMap(link => {
    const start = rendering.positionToLineColumn(doc.state, position.byteOffset(link.start));
    const end = rendering.positionToLineColumn(doc.state, position.byteOffset(link.end));
    return start && end ? [{ id: link.id, kind: "link" as const, start, end, destinations: link.targets.map(id => ({ id, label: "Go to linked cell" })) }] : [];
  }) : emptyDecorations);
  let caret = $state<Caret>({ line: 0, column: 0 });
  let anchor = $state<Caret | null>(null);
  let surface = $state<EditorSurface>();
  let closingDoc = untrack(() => doc);
  let pointerEntry = false;
  export function focusAt(event: MouseEvent, activating = false): void {
    if (activating) pointerEntry = true;
    surface?.focusAt(event);
  }
  export function selected() { if (!anchor) return null; const { start, end } = orderCarets(anchor, caret); return doc.linkRange(start, end); }
  export function focus(): void { surface?.focus(); }
  $effect(() => {
    if (!active) {
      untrack(() => { closingDoc.closeHistoryGroup(); anchor = null; });
      return;
    }
    const target = entry;
    const currentDoc = doc;
    closingDoc = currentDoc;
    const currentSurface = surface;
    if (!currentSurface) return;
    untrack(() => {
      // The activating press already placed the caret and started its drag.
      // Reapplying the entry would clear a selection made before this effect runs.
      if (pointerEntry) pointerEntry = false;
      else if (target.kind === "caret") currentSurface.placeAtCaret(currentDoc.clamp(target));
      else currentSurface.placeAtEdge(target.edge, target.goalX);
    });
    let cancelled = false;
    void tick().then(() => { if (!cancelled) currentSurface.focus(); });
    return () => { cancelled = true; };
  });
  function keydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    onCaret?.({ ...caret });
    if (onKeydown?.(event)) return true;
    const accel = event.ctrlKey || event.metaKey;
    if (event.shiftKey && !accel && !event.altKey) {
      const command = ({ ArrowLeft: "focusLeft", ArrowRight: "focusRight", ArrowUp: "focusUp", ArrowDown: "focusDown" } as Partial<Record<string, Command>>)[event.key];
      if (command) { event.stopPropagation(); onCommand(command); return true; }
    }
    let command: Command | undefined;
    if (accel && event.key.toLowerCase() === "s") command = "save";
    if (accel && event.key.toLowerCase() === "z") command = event.shiftKey ? "redo" : "undo";
    if (accel && event.key.toLowerCase() === "y") command = "redo";
    if (event.key === "Enter" && event.shiftKey && !accel && !event.altKey) command = "newSibling";
    if (event.key === "Enter" && event.shiftKey && event.altKey && !accel) command = "newSiblingBefore";
    const cellModifier = !event.shiftKey && (side === "left"
      ? event.altKey && !accel
      : accel && !event.altKey);
    if (event.key === "Enter" && cellModifier) command = side === "left" ? "split" : "newChild";
    if (event.key === "Delete" && event.shiftKey && !accel && !event.altKey) command = "removeRow";
    if (event.key === "Delete" && cellModifier) command = side === "left" ? "removeLeft" : "removeChildren";
    if (event.altKey && event.key === "ArrowUp") command = "moveUp";
    if (event.altKey && event.key === "ArrowDown") command = "moveDown";
    if (command) { event.stopPropagation(); onCommand(command, { ...caret }); return true; }
    if (!accel && !event.altKey && !event.shiftKey) {
      const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as Record<string, Boundary>)[event.key];
      if (direction && surface?.atBoundary(direction)) {
        event.stopPropagation(); onBoundary(direction, surface.horizontalGoal()); return true;
      }
    }
    return false;
  }
  onDestroy(() => closingDoc.closeHistoryGroup());
</script>
<EditorSurface {doc} {decorations} {onDestination} {annotationsDisabled} readonly={!active} bind:caret bind:anchor bind:this={surface} autoHeight onKeydown={keydown} {onHeight} {onCaret} {initialMeasurements} />
