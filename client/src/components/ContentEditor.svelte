<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import EditorSurface from "../lib/editor/EditorSurface.svelte";
  import { sameCaret } from "../lib/editor/document-store.svelte.js";
  import type { EditorDocument, Caret } from "../lib/editor/document-store.svelte.js";
  import type { Entry, Boundary, Command } from "../lib/editor/content-host.js";
  let { doc, active = true, entry, onBoundary, onCommand, onKeydown, onHeight, onCaret, initialMeasurements, side }: { doc: EditorDocument; active?: boolean; entry: Entry; side: "left" | "right"; onBoundary: (direction: Boundary, goalX: number) => void; onCommand: (command: Command, caret?: Caret) => void; onKeydown?: (event: KeyboardEvent) => boolean; onHeight?: (height: number) => void; onCaret?: (caret: Caret) => void; initialMeasurements?: { width: number; heights: number[] } } = $props();
  let caret = $state<Caret>({ line: 0, column: 0 });
  let anchor = $state<Caret | null>(null);
  let surface = $state<EditorSurface>();
  let closingDoc = untrack(() => doc);
  export function focusAt(event: MouseEvent): void { surface?.focusAt(event); }
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
      if (target.kind === "caret") currentSurface.placeAtCaret(currentDoc.clamp(target));
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
    if (event.altKey && event.key === "ArrowLeft") command = "otherColumnLeft";
    if (event.altKey && event.key === "ArrowRight") command = "otherColumnRight";
    if (accel && event.key === ".") command = "enter";
    if (accel && event.key === ",") command = "leave";
    if (accel && event.key.toLowerCase() === "s") command = "save";
    if (accel && event.key.toLowerCase() === "z") command = event.shiftKey ? "redo" : "undo";
    if (accel && event.key.toLowerCase() === "y") command = "redo";
    if (event.key === "Enter" && event.shiftKey && !accel && !event.altKey) command = "newSibling";
    if (event.key === "Enter" && accel && !event.shiftKey && !event.altKey) command = side === "left" ? "split" : "newChild";
    if (event.altKey && event.key === "ArrowUp") command = "moveUp";
    if (event.altKey && event.key === "ArrowDown") command = "moveDown";
    if (event.key === "Backspace" && !accel && !event.altKey && !event.shiftKey) {
      if ((!anchor || sameCaret(anchor, caret)) && side === "left" && caret.line === 0 && caret.column === 0) command = "join";
      if (side === "right" && doc.text() === "") command = "deleteContainer";
    }
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
<EditorSurface {doc} readonly={!active} bind:caret bind:anchor bind:this={surface} autoHeight onKeydown={keydown} {onHeight} {onCaret} {initialMeasurements} />
