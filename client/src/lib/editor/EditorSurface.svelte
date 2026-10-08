<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { css, cx } from "../../../../styled-system/css";
  import type { Caret, EditorDocument } from "./document-store.svelte.js";
  import { orderCarets, sameCaret } from "./document-store.svelte.js";
  import {
    caretPoint,
    pointToCaret,
    selectionRects,
    visibleRange,
  } from "./geometry.js";

  import { arithmeticMeasurer, domLineMeasurer } from "./line-measurer.js";
  import { moveVisualRow, visualRowEdge, visualCaret, rowAt } from "./visual-navigation.js";
  import EditorLine from "./EditorLine.svelte";
  import {
    MeasuredLayout, estimateLineHeight, captureScrollAnchor, anchorScrollTop,
    spliceScrollAnchor, type ScrollAnchor,
  } from "./vertical-layout.js";

  export type EditorMode = "insert" | "normal";

  let {
    doc,
    caret = $bindable({ line: 0, column: 0 }),
    anchor = $bindable(null),
    mode = "insert",
    readonly = false,
    autoHeight = false,
    onHeight,
    onKeydown,
    initialMeasurements,
    onCaret,
  }: {
    doc: EditorDocument;
    /** Where the caret is, in (line, column) characters. */
    caret?: Caret;
    /** The other end of the selection, or null when there is none. */
    anchor?: Caret | null;
    /** Only the cursor's shape and whether typing inserts. Vim owns the rest. */
    mode?: EditorMode;
    readonly?: boolean;
    /** Render every line and let the page own scrolling. */
    autoHeight?: boolean;
    onHeight?: (height: number) => void;
    initialMeasurements?: { width: number; heights: number[] };
    onCaret?: (caret: Caret) => void;
    /**
     * Offer each key to the host first. A true result skips default handling, allowing Vim
     * mode without coupling the surface to it.
     */
    onKeydown?: (event: KeyboardEvent) => boolean;
  } = $props();

  /** Height of each visual row. */
  const LINE_HEIGHT = 20;
  const FONT_SIZE = 12.5;
  const PAD_X = 12;
  const PAD_Y = 8;
  const OVERSCAN = 6;

  let scrollEl: HTMLDivElement | undefined = $state();
  let sinkEl: HTMLTextAreaElement | undefined = $state();
  let scrollTop = $state(0);
  let viewportHeight = $state(400);
  let viewportWidth = $state(untrack(() => initialMeasurements?.width || 600));
  let focused = $state(false);
  let layoutVersion = $state(0);
  let resizeObserver: ResizeObserver | null = null;
  let goalX: number | undefined;
  let pendingCaretScroll = false;
  $effect(() => {
    const point = { ...caret };
    const notify = onCaret;
    untrack(() => notify?.(point));
  });

  /**
   * Track rendered line elements for event-time measurement. The `lineEl` action adds entries
   * and removes them when lines leave the DOM. This map does not drive rendering.
   */
  const lineEls: Record<number, HTMLDivElement | undefined> = {};
  const rowStarts = new Map<number, { text: string; width: number; rows: { top: number; column: number }[] }>();

  function lineEl(node: HTMLDivElement, lineNumber: number) {
    lineEls[lineNumber] = node;
    resizeObserver?.observe(node);
    return {
      destroy() {
        resizeObserver?.unobserve(node);
        delete lineEls[lineNumber];
        rowStarts.delete(lineNumber);
      },
    };
  }

  /**
   * Text the IME is still composing. Held here and drawn into the line rather than
   * dispatched, so an abandoned composition leaves no edit and no undo entry behind. The
   * document only hears about it once `compositionend` says what it settled on.
   */
  let preedit = $state("");
  let composing = $state(false);
  let compositionSelection: { start: Caret; end: Caret } | null = null;

  const measure = domLineMeasurer((line) => lineEls[line] ?? null);
  const layout = $derived.by(() => {
    const currentDoc = doc;
    return untrack(() => {
      const measured = new MeasuredLayout(currentDoc.lineCount, line =>
        estimateLineHeight(currentDoc.lineText(line), viewportWidth - PAD_X * 2, FONT_SIZE * 0.6, LINE_HEIGHT));
      initialMeasurements?.heights.forEach((height, line) => {
        if (line < currentDoc.lineCount && height > 0 && Number.isFinite(height)) measured.setHeight(line, height);
      });
      return measured;
    });
  });

  function scrollAnchor(): ScrollAnchor | null {
    return !autoHeight && scrollEl ? captureScrollAnchor(layout, scrollEl.scrollTop, PAD_Y) : null;
  }

  function restoreScroll(anchor: ScrollAnchor | null): void {
    if (!anchor || !scrollEl || autoHeight) return;
    const element = scrollEl;
    const target = anchorScrollTop(layout, anchor, PAD_Y);
    element.scrollTop = target;
    scrollTop = element.scrollTop;
    const applied = element.scrollTop;
    // Retry after the content height reaches the DOM, unless the user has scrolled again.
    void tick().then(() => {
      if (scrollEl === element && element.scrollTop === applied) {
        element.scrollTop = target;
        scrollTop = element.scrollTop;
      }
    });
  }

  $effect(() => {
    const currentDoc = doc;
    const currentLayout = layout;
    return currentDoc.subscribeEdits(({ change }) => {
      if (currentDoc !== doc) return;
      let anchor = scrollAnchor();
      currentLayout.splice(change.fromLine, change.oldEndLine - change.fromLine,
        change.newEndLine - change.fromLine);
      if (anchor) anchor = spliceScrollAnchor(anchor, change.fromLine, change.oldEndLine,
        change.newEndLine, currentLayout.lineCount);
      layoutVersion++;
      restoreScroll(anchor);
    });
  });

  onMount(() => {
    resizeObserver = new ResizeObserver(entries => {
      const anchor = scrollAnchor();
      const cached = anchor ? rowStarts.get(anchor.line) : undefined;
      const oldRow = anchor && cached ? cached.rows[rowAt(cached.rows.map(row => ({ ...row, height: LINE_HEIGHT })), anchor.offset)] : undefined;
      let changed = false;
      let rewrapped = false;
      const root = entries.find(entry => entry.target === scrollEl);
      if (root) {
        const width = root.contentRect.width;
        if (width > 0 && width !== viewportWidth) {
          viewportWidth = width;
          layout.resetEstimates();
          rewrapped = true;
          changed = true;
        }
        if (root.contentRect.height > 0) viewportHeight = root.contentRect.height;
      }
      for (const entry of entries) {
        if (entry.target !== scrollEl) {
          const line = Number((entry.target as HTMLElement).dataset.line);
          if (lineEls[line] !== entry.target || line >= layout.lineCount) continue;
          if (entry.contentRect.height > 0)
            changed = layout.setHeight(line, entry.contentRect.height) || changed;
        }
      }
      if (changed) {
        layoutVersion++;
        measurementVersion++;
        if (rewrapped && anchor && oldRow && lineEls[anchor.line]?.textContent === cached?.text) {
          anchor.offset = measure.columnToPoint(anchor.line, oldRow.column).y + anchor.offset - oldRow.top;
        }
        restoreScroll(anchor);
      }
    });
    if (scrollEl) {
      resizeObserver.observe(scrollEl);
      if (scrollEl.clientHeight > 0) viewportHeight = scrollEl.clientHeight;
      if (scrollEl.clientWidth > 0 && scrollEl.clientWidth !== viewportWidth) {
        viewportWidth = scrollEl.clientWidth;
        layout.resetEstimates();
        layoutVersion++;
      }
    }
    for (const element of Object.values(lineEls)) if (element) resizeObserver.observe(element);
    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  const window_ = $derived.by(() => {
    void layoutVersion;
    if (autoHeight) return { startLine: 0, visibleLineCount: doc.lineCount };
    return visibleRange(
      { scrollTop, height: viewportHeight, layout, lineCount: doc.lineCount },
      OVERSCAN,
    );
  });
  const lines = $derived(doc.visibleLines(window_.startLine, window_.visibleLineCount, 0));
  const contentHeight = $derived.by(() => {
    void layoutVersion;
    return layout.totalHeight;
  });
  let measurementVersion = $state(0);

  $effect(() => {
    const height = contentHeight + PAD_Y * 2;
    const notify = onHeight;
    untrack(() => notify?.(height));
  });

  // Read geometry after Svelte has updated the spans, including composition text.
  $effect(() => {
    void lines;
    void viewportWidth;
    void caret;
    void anchor;
    void preedit;
    void composing;
    let active = true;
    void tick().then(() => {
      if (!active) return;
      const anchor = scrollAnchor();
      let changed = false;
      // An edited line may keep its old DOM height, so ResizeObserver would not report it
      // after splice replaced that measurement with an estimate. Read mounted lines too.
      for (const [number, element] of Object.entries(lineEls)) {
        const line = Number(number);
        const height = element?.getBoundingClientRect().height ?? 0;
        if (height > 0 && line < layout.lineCount)
          changed = layout.setHeight(line, height) || changed;
        if (element && height > 0) {
          const text = element.textContent ?? "";
          const cached = rowStarts.get(line);
          if (!cached || cached.text !== text || cached.width !== viewportWidth) {
            rowStarts.set(line, { text, width: viewportWidth, rows: measure.visualRows(line).map(row => ({
              top: row.top, column: measure.pointToColumn(line, 0, row.top),
            })) });
          }
        }
      }
      if (changed) {
        layoutVersion++;
        restoreScroll(anchor);
      }
      measurementVersion++;
      if (pendingCaretScroll && lineEls[caret.line]) {
        pendingCaretScroll = !ensureCaretVisible();
      }
    });
    return () => {
      active = false;
    };
  });

  const selection = $derived.by(() => {
    if (!anchor || sameCaret(anchor, caret)) return null;
    return orderCarets(anchor, caret);
  });

  // Recomputed against the document's revision as well as the carets, because the same
  // (line, column) pair sits at a different pixel once the text around it has changed.
  const rects = $derived.by(() => {
    void layoutVersion;
    void measurementVersion;
    void doc.state.revision;
    void lines;
    if (readonly || !selection) return [];
    return selectionRects(selection.start, selection.end, layout, measure, (line) =>
      doc.lineText(line).length,
    );
  });

  const caretXY = $derived.by(() => {
    void layoutVersion;
    void measurementVersion;
    void doc.state.revision;
    void lines;
    const measuredCaret = composing
      ? { line: caret.line, column: caret.column + preedit.length }
      : caret;
    return caretPoint(measuredCaret, layout, measure);
  });

  /** Normal-mode block cursor width, matching the current cell. */
  const caretWidth = $derived.by(() => {
    void measurementVersion;
    void doc.state.revision;
    if (mode !== "normal") return 2;
    const text = doc.lineText(caret.line);
    if (caret.column >= text.length) return FONT_SIZE * 0.6;
    return Math.max(
      2,
      measure.columnToPoint(caret.line, doc.columnAfter(caret.line, caret.column), "upstream").x -
        measure.columnToPoint(caret.line, caret.column).x,
    );
  });

  export function focus(): void {
    sinkEl?.focus();
  }
  export function atBoundary(direction: "up" | "down" | "left" | "right"): boolean {
    if (selection) return false;
    if (direction === "left") return caret.line === 0 && caret.column === 0;
    if (direction === "right") return caret.line === doc.lineCount - 1 && caret.column === doc.lineText(caret.line).length;
    const geometry = navigationMeasure();
    const point = geometry.columnToPoint(caret.line, caret.column, caret.affinity);
    const rows = geometry.visualRows(caret.line);
    const row = rowAt(rows, point.y);
    return direction === "up" ? caret.line === 0 && row === 0 : caret.line === doc.lineCount - 1 && row === rows.length - 1;
  }
  export function horizontalGoal(): number {
    return goalX ?? navigationMeasure().columnToPoint(caret.line, caret.column, caret.affinity).x;
  }
  export function placeAtEdge(edge: "start" | "end", x?: number): void {
    const line = edge === "start" ? 0 : doc.lineCount - 1;
    const geometry = navigationMeasure();
    const rows = geometry.visualRows(line);
    setCaret(x === undefined ? { line, column: edge === "start" ? 0 : doc.lineText(line).length }
      : visualCaret(line, x, edge === "start" ? rows[0].top : rows.at(-1)!.top, geometry), false, true);
    goalX = x;
  }

  function setCaret(next: Caret, extend: boolean, keepGoal = false): void {
    if (!keepGoal) goalX = undefined;
    const clamped = doc.clamp(next);
    if (extend) anchor ??= caret;
    else anchor = null;
    caret = clamped;
  }

  function collapse(): void {
    anchor = null;
  }

  /** The selected span, ordered, or null when the selection is empty. */
  function selected(): { start: Caret; end: Caret } | null {
    return selection;
  }

  function deleteSelection(): boolean {
    const span = selected();
    if (!span) return false;
    // The live caret is one end of the selection, and which end depends on the direction
    // it was dragged. It is where undo has to put it back to.
    doc.closeHistoryGroup();
    caret = doc.delete(span.start, span.end, caret);
    doc.closeHistoryGroup();
    collapse();
    return true;
  }

  function insertText(text: string): void {
    goalX = undefined;
    const span = selected();
    caret = span ? doc.replace(span.start, span.end, text, caret) : doc.insert(caret, text);
    collapse();
  }

  // ── Keyboard ──────────────────────────────────────────────────
  function moveTo(next: Caret, extend: boolean): void {
    setCaret(next, extend);
  }

  function navigationMeasure() {
    // jsdom and hidden surfaces have no rendered geometry. Keep logical movement usable
    // there; browser input uses the measured proportional text and wrapped rows.
    return (lineEls[caret.line]?.getBoundingClientRect().height ?? 0) > 0
      ? measure : arithmeticMeasurer(line => doc.lineText(line), FONT_SIZE * 0.6, LINE_HEIGHT);
  }

  function moveVertical(direction: -1 | 1, extend: boolean): void {
    const moved = moveVisualRow(caret, direction, doc.lineCount, navigationMeasure(), goalX);
    goalX = moved.goalX;
    setCaret(moved.caret, extend, true);
  }

  function pageLine(direction: -1 | 1): number {
    const target = layout.top(caret.line) + direction * viewportHeight;
    const line = layout.lineAt(target);
    // PageUp counts complete rows, matching the imported fixed-height behavior.
    return direction < 0 && layout.top(line) < target ? Math.min(line + 1, doc.lineCount - 1) : line;
  }

  function handleKeydown(event: KeyboardEvent): void {
    // Let keys reach the host so it can handle save and close actions and stop them from
    // reaching the board.
    //
    // During composition, leave input to the browser and IME. Commit text at compositionend.
    if (composing) { event.stopPropagation(); return; }
    if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Shift", "Control", "Meta", "Alt"].includes(event.key))
      goalX = undefined;

    if (onKeydown?.(event)) {
      event.preventDefault();
      return;
    }

    const extend = event.shiftKey;
    const accel = event.ctrlKey || event.metaKey;
    const lastLine = Math.max(0, doc.lineCount - 1);

    // Let the parent handle saving and closing.
    if (accel && (event.key === "s" || event.key === "S")) return;

    if (accel) {
      switch (event.key) {
        case "z":
        case "Z": {
          event.preventDefault();
          // Move the caret to the undone edit so the changed text stays visible.
          const to = event.shiftKey ? doc.redo() : doc.undo();
          collapse();
          caret = doc.clamp(to ?? caret);
          return;
        }
        case "y": {
          event.preventDefault();
          const to = doc.redo();
          collapse();
          caret = doc.clamp(to ?? caret);
          return;
        }
        case "a":
          event.preventDefault();
          anchor = { line: 0, column: 0 };
          caret = { line: lastLine, column: doc.lineText(lastLine).length };
          return;
        case "Home":
          event.preventDefault();
          moveTo({ line: 0, column: 0 }, extend);
          return;
        case "End":
          event.preventDefault();
          moveTo({ line: lastLine, column: doc.lineText(lastLine).length }, extend);
          return;
      }
      // Leave clipboard accelerators to the browser, which dispatches the handled clipboard
      // events.
      return;
    }

    switch (event.key) {
      case "ArrowLeft": {
        event.preventDefault();
        if (caret.column > 0)
          moveTo({ line: caret.line, column: doc.columnBefore(caret.line, caret.column) }, extend);
        else if (caret.line > 0)
          moveTo({ line: caret.line - 1, column: doc.lineText(caret.line - 1).length }, extend);
        return;
      }
      case "ArrowRight": {
        event.preventDefault();
        if (caret.column < doc.lineText(caret.line).length)
          moveTo({ line: caret.line, column: doc.columnAfter(caret.line, caret.column) }, extend);
        else if (caret.line < lastLine) moveTo({ line: caret.line + 1, column: 0 }, extend);
        return;
      }
      case "ArrowUp":
        event.preventDefault();
        moveVertical(-1, extend);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveVertical(1, extend);
        return;
      case "PageUp":
        event.preventDefault();
        moveTo(
          { line: pageLine(-1), column: caret.column },
          extend,
        );
        return;
      case "PageDown":
        event.preventDefault();
        moveTo(
          { line: pageLine(1), column: caret.column },
          extend,
        );
        return;
      case "Home":
        event.preventDefault();
        moveTo(visualRowEdge(caret, "start", navigationMeasure()), extend);
        return;
      case "End":
        event.preventDefault();
        moveTo(visualRowEdge(caret, "end", navigationMeasure()), extend);
        return;
    }

    if (readonly) return;

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        insertText("\n");
        return;
      case "Tab":
        event.preventDefault();
        insertText("  ");
        return;
      case "Backspace": {
        event.preventDefault();
        if (deleteSelection()) return;
        // Restore the caret to the deleted range's end when undoing Backspace.
        if (caret.column > 0)
          caret = doc.delete(
            { line: caret.line, column: doc.columnBefore(caret.line, caret.column) },
            caret,
            caret,
          );
        else if (caret.line > 0)
          caret = doc.delete(
            { line: caret.line - 1, column: doc.lineText(caret.line - 1).length },
            caret,
            caret,
          );
        return;
      }
      case "Delete": {
        event.preventDefault();
        if (deleteSelection()) return;
        const lineLength = doc.lineText(caret.line).length;
        if (caret.column < lineLength)
          caret = doc.delete(caret, {
            line: caret.line,
            column: doc.columnAfter(caret.line, caret.column),
          });
        else if (caret.line < lastLine)
          caret = doc.delete(caret, { line: caret.line + 1, column: 0 });
        return;
      }
    }

    // A printable character. Anything longer than one code point is a named key we have
    // not claimed, and belongs to nobody.
    if ([...event.key].length === 1 && !event.altKey) {
      event.preventDefault();
      insertText(event.key);
    }
  }

  // Keep composition text in the input sink and display the preedit inline. Update the
  // document only when composition commits.
  function handleCompositionStart(): void {
    goalX = undefined;
    composing = true;
    preedit = "";
    compositionSelection = selected();
    doc.closeHistoryGroup();
  }

  function handleCompositionUpdate(event: CompositionEvent): void {
    preedit = event.data ?? "";
  }

  function handleCompositionEnd(event: CompositionEvent): void {
    if (!composing) return;
    composing = false;
    const composed = event.data ?? "";
    preedit = "";
    if (sinkEl) sinkEl.value = "";
    const span = compositionSelection;
    compositionSelection = null;
    // Replace a selection only after commit. Cancelling composition preserves its text.
    if (composed && !readonly) {
      doc.transact(() => {
        caret = span ? doc.replace(span.start, span.end, composed, caret) : doc.insert(caret, composed);
        collapse();
      }, "composition");
    }
    doc.closeHistoryGroup();
  }

  function handleBlur(): void {
    goalX = undefined;
    focused = false;
    composing = false;
    preedit = "";
    compositionSelection = null;
    if (sinkEl) sinkEl.value = "";
    doc.closeHistoryGroup();
  }

  $effect(() => {
    if (readonly) untrack(handleBlur);
  });

  /**
   * Handle text input that arrives without keydown, such as mobile keyboard commits or
   * dictation. Composition uses its separate handler.
   */
  function handleInput(): void {
    if (composing || !sinkEl) return;
    const typed = sinkEl.value;
    sinkEl.value = "";
    if (typed && focused && !readonly) insertText(typed);
  }

  function handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    if (readonly) return;
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      doc.closeHistoryGroup();
      insertText(text);
      doc.closeHistoryGroup();
    }
  }

  function handleCopy(event: ClipboardEvent): void {
    const span = selected();
    if (!span) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", doc.textBetween(span.start, span.end));
  }

  function handleCut(event: ClipboardEvent): void {
    const span = selected();
    if (!span) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", doc.textBetween(span.start, span.end));
    if (!readonly) deleteSelection();
  }

  // ── Pointer ───────────────────────────────────────────────────
  function caretFromEvent(event: MouseEvent): Caret | null {
    const sizer = scrollEl?.firstElementChild as HTMLElement | undefined;
    if (!sizer) return null;
    const box = sizer.getBoundingClientRect();
    // Subtract padding to convert pointer positions to text coordinates. Add the same offsets
    // back when drawing the caret and selection.
    return pointToCaret(
      event.clientX - box.left - PAD_X,
      event.clientY - box.top - PAD_Y,
      layout,
      doc.lineCount,
      measure,
    );
  }

  /** True for a click on the native scrollbar rather than on the text. */
  function onScrollbar(event: MouseEvent): boolean {
    if (!scrollEl) return false;
    const { clientWidth, clientHeight } = scrollEl;
    // Without measurable layout, do not classify the click as a scrollbar drag.
    if (clientWidth === 0 || clientHeight === 0) return false;
    const box = scrollEl.getBoundingClientRect();
    // `clientWidth`/`clientHeight` exclude the scrollbars, so a point past either is on one.
    return event.clientX - box.left > clientWidth || event.clientY - box.top > clientHeight;
  }

  function handleMousedown(event: MouseEvent): void {
    if (readonly) return;
    if (event.button !== 0) return;
    // Dragging the scrollbar is the browser's, and preventing its default below would stop
    // the thumb from moving.
    if (onScrollbar(event)) return;

    const at = caretFromEvent(event);
    if (!at) return;

    // Prevent mousedown's default focus change from blurring the input sink just focused by
    // this handler.
    event.preventDefault();
    setCaret(at, event.shiftKey);
    focus();

    // Dragging is tracked on the window rather than the surface so a selection that runs
    // off the panel keeps extending instead of stopping at the edge.
    const onMove = (move: MouseEvent) => {
      const to = caretFromEvent(move);
      if (to) setCaret(to, true);
    };
    const onUp = () => {
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup", onUp);
    };
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
  }

  // Follow caret changes without depending on reactive scroll state. Read the element's
  // current viewport directly so manual scrolling does not trigger a jump back to the caret.
  function ensureCaretVisible(): boolean {
    if (!scrollEl || autoHeight || readonly || scrollEl.clientHeight === 0) return true;
    const mounted = lineEls[caret.line];
    const point = mounted ? measure.columnToPoint(caret.line, caret.column, caret.affinity)
      : arithmeticMeasurer(line => doc.lineText(line), FONT_SIZE * 0.6, LINE_HEIGHT,
          Math.max(FONT_SIZE * 0.6, viewportWidth - PAD_X * 2))
          .columnToPoint(caret.line, caret.column, caret.affinity);
    const top = PAD_Y + layout.top(caret.line) + point.y;
    const viewTop = scrollEl.scrollTop;
    if (top < viewTop) scrollEl.scrollTop = top;
    else if (top + LINE_HEIGHT > viewTop + scrollEl.clientHeight)
      scrollEl.scrollTop = top + LINE_HEIGHT - scrollEl.clientHeight;
    scrollTop = scrollEl.scrollTop;
    const sizer = scrollEl.firstElementChild as HTMLElement | null;
    return !!mounted && parseFloat(sizer?.style.height ?? "0") === layout.totalHeight + PAD_Y * 2;
  }

  $effect(() => {
    void caret.line;
    void caret.column;
    void caret.affinity;
    void layout;
    if (autoHeight || readonly) return;
    untrack(() => {
      pendingCaretScroll = !ensureCaretVisible();
    });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={scrollEl}
  class={css({
    position: "relative",
    flex: "1",
    overflow: "auto",
    background: "ink.white",
    fontFamily: "mono",
    fontSize: "12.5px",
    color: "ink.black",
    outline: "none",
  })}
  style:flex={autoHeight ? "none" : "1"}
  style:height={autoHeight ? `${contentHeight + PAD_Y * 2}px` : undefined}
  style:overflow={autoHeight ? "visible" : "auto"}
  style:overflow-anchor={autoHeight ? "auto" : "none"}
  style:cursor={readonly ? "default" : "text"}
  onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
  onmousedown={handleMousedown}
  data-testid="editor-surface"
>
  <!-- Size the scroll area for the whole document, including virtualized lines. Keep this element unpadded because its children are absolutely positioned. Apply text padding to lines and caret or selection coordinates instead. -->
  <div
    class={css({ position: "relative", width: "100%", boxSizing: "border-box" })}
    style:height={`${contentHeight + PAD_Y * 2}px`}
  >
    <!-- Selection, painted under the text as rectangles. -->
    {#each rects as rect, i (i)}
      <div
        class={css({
          position: "absolute",
          background: "select.bg",
          pointerEvents: "none",
          zIndex: "0",
        })}
        style:top={`${rect.top + PAD_Y}px`}
        style:left={`${rect.left + PAD_X}px`}
        style:width={rect.width === null
          ? `calc(100% - ${rect.left + PAD_X}px)`
          : `${rect.width}px`}
        data-testid="editor-selection"
        style:height={`${rect.height}px`}
      ></div>
    {/each}

    <!-- Text: only the window, absolutely positioned by line number. -->
    {#each lines as line (line.lineNumber)}
      <EditorLine line={line.lineNumber} text={line.content}
        top={layout.top(line.lineNumber) + PAD_Y} padding={PAD_X} rowHeight={LINE_HEIGHT}
        preedit={composing && line.lineNumber === caret.line ? preedit : ""}
        column={caret.column} register={lineEl} />
    {/each}

    <!-- Cursor: a sibling of the text, never spliced into it, so drawing it cannot move
         a single character on the line. -->
    {#if !readonly && focused && !composing}
      <div
        class={cx(
          css({ position: "absolute", pointerEvents: "none", zIndex: "2" }),
          mode === "normal"
            ? css({ background: "select.accent", opacity: "0.35" })
            : css({ background: "ink.black" }),
        )}
        style:top={`${caretXY.y + PAD_Y}px`}
        style:left={`${caretXY.x + PAD_X}px`}
        style:width={`${caretWidth}px`}
        style:height={`${LINE_HEIGHT}px`}
        data-testid="editor-cursor"
      ></div>
    {/if}

    <!-- The IME sink. One pixel, invisible, parked at the caret so the candidate window
         opens where the text will land. It renders nothing and holds no document text. -->
    {#if !readonly}<textarea
      bind:this={sinkEl}
      class={css({
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        border: "none",
        outline: "none",
        resize: "none",
        overflow: "hidden",
        opacity: "0",
        zIndex: "3",
        fontFamily: "mono",
        fontSize: "12.5px",
      })}
      style:top={`${caretXY.y + PAD_Y}px`}
      style:left={`${caretXY.x + PAD_X}px`}
      onkeydown={handleKeydown}
      oninput={handleInput}
      oncompositionstart={handleCompositionStart}
      oncompositionupdate={handleCompositionUpdate}
      oncompositionend={handleCompositionEnd}
      onpaste={handlePaste}
      oncopy={handleCopy}
      oncut={handleCut}
      onfocus={() => (focused = true)}
      onblur={handleBlur}
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      aria-label="File contents"
      data-testid="editor-sink"
    ></textarea>{/if}
  </div>
</div>
