import { describe, expect, it } from "vitest";
import { arithmeticMeasurer } from "./line-measurer.js";
import { moveVisualRow, visualCaret, visualRowEdge } from "./visual-navigation.js";

describe("visual row navigation", () => {
  const measure = arithmeticMeasurer((line) => ["abcdefghij", "x", "abcdefghij"][line], 10, 20, 40);
  it("keeps the two visual positions at a shared offset distinct", () => {
    expect(visualCaret(0, 100, 0, measure)).toEqual({ line: 0, column: 4, affinity: "upstream" });
    expect(visualCaret(0, 0, 20, measure)).toEqual({ line: 0, column: 4 });
    expect(visualRowEdge({ line: 0, column: 6 }, "start", measure)).toEqual({ line: 0, column: 4 });
    expect(visualRowEdge({ line: 0, column: 6 }, "end", measure)).toEqual({
      line: 0,
      column: 8,
      affinity: "upstream",
    });
    expect(visualRowEdge({ line: 0, column: 4, affinity: "upstream" }, "start", measure)).toEqual({
      line: 0,
      column: 0,
    });
  });
  it("moves within a logical line and reverses at the same horizontal position", () => {
    const down = moveVisualRow({ line: 0, column: 2 }, 1, 3, measure);
    expect(down).toEqual({ caret: { line: 0, column: 6 }, goalX: 20 });
    expect(moveVisualRow(down.caret, -1, 3, measure, down.goalX).caret).toEqual({
      line: 0,
      column: 2,
    });
  });
  it("retains the horizontal goal across short rows and logical lines", () => {
    const first = moveVisualRow({ line: 0, column: 7 }, 1, 3, measure);
    expect(first).toEqual({ caret: { line: 0, column: 10 }, goalX: 30 });
    const short = moveVisualRow(first.caret, 1, 3, measure, first.goalX);
    expect(short.caret).toEqual({ line: 1, column: 1 });
    expect(moveVisualRow(short.caret, 1, 3, measure, short.goalX).caret).toEqual({
      line: 2,
      column: 3,
    });
  });
  it("stops at document boundaries", () => {
    expect(moveVisualRow({ line: 0, column: 2 }, -1, 3, measure).caret).toEqual({
      line: 0,
      column: 2,
    });
    expect(moveVisualRow({ line: 2, column: 10 }, 1, 3, measure).caret).toEqual({
      line: 2,
      column: 10,
    });
  });
});
