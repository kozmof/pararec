import { afterEach, describe, expect, it, vi } from "vitest";
import { arithmeticMeasurer, domLineMeasurer } from "./line-measurer.js";
import { caretPoint, pointToCaret, selectionRects } from "./geometry.js";
import { FixedLayout } from "./vertical-layout.js";

const rangeDescriptors = Object.getOwnPropertyDescriptors(Range.prototype);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const method of ["getClientRects", "getBoundingClientRect"]) {
    const descriptor = rangeDescriptors[method];
    if (descriptor) Object.defineProperty(Range.prototype, method, descriptor);
    else Reflect.deleteProperty(Range.prototype, method);
  }
  document.body.replaceChildren();
});

describe("arithmetic measurer", () => {
  it("keeps unwrapped columns continuous, including the empty line", () => {
    const measure = arithmeticMeasurer((line) => ["abc", ""][line]);
    expect(measure.columnToPoint(0, 3)).toEqual({ x: 30, y: 0 });
    expect(measure.pointToColumn(0, 29, 0)).toBe(3);
    expect(measure.columnToPoint(1, 5)).toEqual({ x: 0, y: 0 });
    expect(measure.visualRows(1)).toEqual([{ top: 0, height: 20 }]);
  });

  it("maps points and selection rectangles across visual rows", () => {
    const measure = arithmeticMeasurer(() => "abcdefghij", 10, 20, 40);
    expect(measure.columnToPoint(0, 6)).toEqual({ x: 20, y: 20 });
    expect(measure.pointToColumn(0, 22, 25)).toBe(6);
    expect(measure.visualRows(0)).toEqual([
      { top: 0, height: 20 },
      { top: 20, height: 20 },
      { top: 40, height: 20 },
    ]);
    expect(measure.rangeRects(0, 2, 9)).toEqual([
      { top: 0, left: 20, width: 20, height: 20 },
      { top: 20, left: 0, width: 40, height: 20 },
      { top: 40, left: 0, width: 10, height: 20 },
    ]);
    expect(measure.rangeRects(0, 2, null).at(-1)?.width).toBeNull();
    expect(measure.rangeRects(0, 2, 4)).toEqual([{ top: 0, left: 20, width: 20, height: 20 }]);
  });

  it("adds visual-row offsets to document geometry", () => {
    const measure = arithmeticMeasurer(() => "abcdefghij", 10, 20, 40);
    const layout = new FixedLayout(2, 60);
    expect(caretPoint({ line: 1, column: 6 }, layout, measure)).toEqual({ x: 20, y: 80 });
    expect(pointToCaret(20, 80, layout, 2, measure)).toEqual({ line: 1, column: 6 });
    expect(
      selectionRects({ line: 1, column: 2 }, { line: 1, column: 6 }, layout, measure, () => 10),
    ).toEqual([
      { top: 60, left: 20, width: 20, height: 20 },
      { top: 80, left: 0, width: 20, height: 20 },
    ]);
  });
});

/** Stub only browser layout; the measurer still resolves real spans, nodes, and Ranges. */
function spans(wrapped = false) {
  const el = document.createElement("div");
  el.style.paddingLeft = "12px";
  el.style.lineHeight = "20px";
  el.innerHTML =
    '<span data-from="0">ab</span><span data-from="2"><b>cd</b></span><span data-from="4">ef</span>';
  document.body.append(el);
  const nodes = [...el.querySelectorAll("span")].map((span) =>
    span.firstChild instanceof Text ? span.firstChild : span.firstChild!.firstChild!,
  ) as Text[];
  const column = (node: Node, offset: number) => nodes.indexOf(node as Text) * 2 + offset;
  const point = (at: number) => ({
    x: wrapped ? (at % 4) * 10 : at * 10,
    y: wrapped ? Math.floor(at / 4) * 20 : 0,
  });
  const rect = (left: number, top: number, width: number) =>
    ({
      left: 112 + left,
      top: 50 + top,
      width,
      right: 112 + left + width,
      bottom: 70 + top,
      height: 20,
    }) as DOMRect;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(-12, 0, 100));
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value() {
      return [];
    },
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value() {
      return rect(0, 0, 0);
    },
  });
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(function (this: Range) {
    const at = point(column(this.startContainer, this.startOffset));
    return rect(
      at.x,
      at.y,
      (column(this.endContainer, this.endOffset) - column(this.startContainer, this.startOffset)) *
        10,
    );
  });
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    const from = column(this.startContainer, this.startOffset),
      to = column(this.endContainer, this.endOffset);
    if (from === to) return [this.getBoundingClientRect()] as unknown as DOMRectList;
    if (!wrapped) return [this.getBoundingClientRect()] as unknown as DOMRectList;
    const result: DOMRect[] = [];
    for (let at = from; at < to;) {
      const end = Math.min(to, (Math.floor(at / 2) + 1) * 2);
      const start = point(at);
      result.push(rect(start.x, start.y, (end - at) * 10));
      at = end;
    }
    return result as unknown as DOMRectList;
  });
  return { el, nodes, measure: domLineMeasurer(() => el) };
}

describe("span DOM measurer", () => {
  it("distinguishes both sides of a wrap and hits the previous row's end", () => {
    const { measure } = spans(true);
    expect(measure.columnToPoint(0, 4)).toEqual({ x: 0, y: 20 });
    expect(measure.columnToPoint(0, 4, "upstream")).toEqual({ x: 40, y: 0 });
    expect(measure.pointToColumn(0, Infinity, 0)).toBe(4);
    expect(measure.pointToColumn(0, 0, 20)).toBe(4);
  });
  it("measures pre-edit text and the suffix using their displayed columns", () => {
    const { el, measure } = spans();
    el.children[1].setAttribute("data-preedit", "");
    expect(measure.columnToPoint(0, 4)).toEqual({ x: 40, y: 0 });
    expect(measure.rangeRects(0, 1, 5)).toEqual([{ top: 0, left: 10, width: 40, height: 20 }]);
  });

  it("handles empty and unmounted lines without browser rectangle methods", () => {
    const el = document.createElement("div");
    el.innerHTML = '<span data-from="0"></span>';
    const measure = domLineMeasurer((line) => (line === 0 ? el : null));
    expect(measure.columnToPoint(0, 0)).toEqual({ x: 0, y: 0 });
    expect(measure.pointToColumn(0, 100, 0)).toBe(0);
    expect(measure.rangeRects(0, 0, null)).toEqual([{ top: 0, left: 0, width: null, height: 20 }]);
    expect(measure.columnToPoint(1, 4)).toEqual({ x: 0, y: 0 });
    expect(measure.rangeRects(1, 0, null)).toEqual([]);
  });

  it("measures across decorated spans and binary-searches click positions", () => {
    const { measure } = spans();
    for (let column = 0; column <= 6; column++) {
      expect(measure.columnToPoint(0, column)).toEqual({ x: column * 10, y: 0 });
      expect(measure.pointToColumn(0, column * 10, 0)).toBe(column);
    }
    expect(measure.pointToColumn(0, 39, 0)).toBe(4);
    expect(measure.pointToColumn(0, -100, 0)).toBe(0);
    expect(measure.pointToColumn(0, 1000, 0)).toBe(6);
  });

  it("prefers caretPositionFromPoint and converts node offsets to columns", () => {
    const { nodes, measure } = spans();
    const hit = vi.fn(() => ({ offsetNode: nodes[1], offset: 1 }));
    Object.defineProperty(document, "caretPositionFromPoint", { configurable: true, value: hit });
    try {
      expect(measure.pointToColumn(0, 30, 0)).toBe(3);
      expect(hit).toHaveBeenCalledWith(142, 60);
    } finally {
      Reflect.deleteProperty(document, "caretPositionFromPoint");
    }
  });

  it("tries WebKit after a native hit outside the measured line", () => {
    const { nodes, measure } = spans();
    const range = document.createRange();
    range.setStart(nodes[2], 1);
    range.collapse(true);
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: document.body, offset: 0 }),
    });
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => range,
    });
    try {
      expect(measure.pointToColumn(0, 50, 0)).toBe(5);
    } finally {
      Reflect.deleteProperty(document, "caretPositionFromPoint");
      Reflect.deleteProperty(document, "caretRangeFromPoint");
    }
  });

  it("merges span rectangles by row and extends only the last row through the newline", () => {
    const { measure } = spans(true);
    expect(measure.columnToPoint(0, 5)).toEqual({ x: 10, y: 20 });
    expect(measure.pointToColumn(0, 9, 20)).toBe(5);
    expect(measure.visualRows(0)).toEqual([
      { top: 0, height: 20 },
      { top: 20, height: 20 },
    ]);
    expect(measure.rangeRects(0, 0, 6)).toEqual([
      { top: 0, left: 0, width: 40, height: 20 },
      { top: 20, left: 0, width: 20, height: 20 },
    ]);
    expect(measure.rangeRects(0, 0, null).at(-1)?.width).toBeNull();
  });
});
