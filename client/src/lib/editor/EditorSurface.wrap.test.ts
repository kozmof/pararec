import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import EditorSurface from "./EditorSurface.svelte";
import { EditorDocument } from "./document-store.svelte.js";
import * as measurement from "./line-measurer.js";

let doc: EditorDocument;
let wrapWidth: number;
let resize: ResizeObserverCallback;
beforeEach(() => {
  wrapWidth = 40;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(measurement, "domLineMeasurer").mockImplementation((element) => ({
    columnToPoint: (line, column, affinity) =>
      measurement
        .arithmeticMeasurer((at) => element(at)?.textContent ?? "", 10, 20, wrapWidth)
        .columnToPoint(line, column, affinity),
    pointToColumn: (line, x, y) =>
      measurement
        .arithmeticMeasurer((at) => element(at)?.textContent ?? "", 10, 20, wrapWidth)
        .pointToColumn(line, x, y),
    visualRows: (line) =>
      measurement
        .arithmeticMeasurer((at) => element(at)?.textContent ?? "", 10, 20, wrapWidth)
        .visualRows(line),
    rangeRects: (line, from, to) =>
      measurement
        .arithmeticMeasurer((at) => element(at)?.textContent ?? "", 10, 20, wrapWidth)
        .rangeRects(line, from, to),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      height: this.hasAttribute("data-line")
        ? Math.max(1, Math.ceil((this.textContent?.length ?? 0) / (wrapWidth / 10))) * 20
        : 200,
    } as DOMRect;
  });
});
afterEach(() => {
  doc?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function key(key: string, shiftKey = false) {
  await fireEvent.keyDown(screen.getByTestId("editor-sink"), { key, shiftKey });
  await tick();
  await tick();
}

it("moves by visual row and inserts at the previous row's end", async () => {
  doc = new EditorDocument("abcdefghij");
  render(EditorSurface, { props: { doc, caret: { line: 0, column: 2 } } });
  await key("ArrowDown");
  await key("End");
  expect(screen.getByTestId("editor-sink").style.top).toBe("28px");
  await key("!");
  expect(doc.text()).toBe("abcdefgh!ij");
});

it("draws selection across two visual rows and resets the horizontal goal after Home", async () => {
  doc = new EditorDocument("abcdefghij");
  render(EditorSurface, { props: { doc, caret: { line: 0, column: 2 } } });
  await key("ArrowDown", true);
  expect(screen.getAllByTestId("editor-selection")).toHaveLength(2);
  await key("Home");
  await key("ArrowUp");
  await key("!");
  expect(doc.text()).toBe("!abcdefghij");
});

it("keeps the same text row at the viewport top when resizing", async () => {
  doc = new EditorDocument("abcdefghijklmnopqrstuvwxyz".repeat(10));
  render(EditorSurface, { props: { doc } });
  await tick();
  await tick();
  const surface = screen.getByTestId("editor-surface");
  surface.scrollTop = 48;
  await fireEvent.scroll(surface);
  wrapWidth = 20;
  resize(
    [
      { target: surface, contentRect: { width: 44, height: 200 } },
      { target: surface.querySelector("[data-line]"), contentRect: { width: 44, height: 2600 } },
    ] as ResizeObserverEntry[],
    {} as ResizeObserver,
  );
  await tick();
  await tick();
  expect(surface.scrollTop).toBe(88);
});
