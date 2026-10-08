import { describe, expect, it } from "vitest";
import { caretPoint, pointToCaret, selectionRects, visibleRange } from "./geometry.js";
import { FixedLayout, type VerticalLayout } from "./vertical-layout.js";

const measure = {
  columnToX: (_line: number, column: number) => column * 10,
  xToColumn: (_line: number, x: number) => Math.round(x / 10),
};

// A tall middle line catches fixed-height arithmetic leaking into the geometry layer.
const variable: VerticalLayout = {
  totalHeight: 100,
  top: (line) => [0, 20, 80, 100][line],
  height: (line) => [20, 60, 20][line],
  lineAt: (y) => (y < 20 ? 0 : y < 80 ? 1 : 2),
};

describe("vertical layout geometry", () => {
  it("retains the imported fixed-height positions", () => {
    const layout = new FixedLayout(3, 20);
    expect(layout.totalHeight).toBe(60);
    expect(caretPoint({ line: 2, column: 3 }, layout, measure)).toEqual({ x: 30, y: 40 });
    expect(pointToCaret(30, 45, layout, 3, measure)).toEqual({ line: 2, column: 3 });
    expect(layout.lineAt(-10)).toBe(0);
    expect(layout.lineAt(1000)).toBe(2);
    expect(new FixedLayout(0).totalHeight).toBe(20);
  });

  it("resolves caret and click positions using variable line heights", () => {
    const caret = { line: 2, column: 3 };
    const point = caretPoint(caret, variable, measure);
    expect(point).toEqual({ x: 30, y: 80 });
    expect(pointToCaret(point.x, point.y, variable, 3, measure)).toEqual(caret);
    expect(pointToCaret(10, 70, variable, 3, measure)).toEqual({ line: 1, column: 1 });
  });

  it("draws selection rectangles at each line's own height and top", () => {
    expect(
      selectionRects({ line: 0, column: 1 }, { line: 2, column: 2 }, variable, measure, () => 5),
    ).toEqual([
      { top: 0, left: 10, width: null, height: 20 },
      { top: 20, left: 0, width: null, height: 60 },
      { top: 80, left: 0, width: 20, height: 20 },
    ]);
  });

  it("finds the rendered band inside a tall line and at exact line boundaries", () => {
    expect(visibleRange({ scrollTop: 25, height: 30, lineCount: 3, layout: variable }, 0)).toEqual({
      startLine: 1,
      visibleLineCount: 1,
    });
    expect(visibleRange({ scrollTop: 20, height: 60, lineCount: 3, layout: variable }, 0)).toEqual({
      startLine: 1,
      visibleLineCount: 1,
    });
    expect(visibleRange({ scrollTop: 70, height: 20, lineCount: 3, layout: variable }, 0)).toEqual({
      startLine: 1,
      visibleLineCount: 2,
    });
  });
});
