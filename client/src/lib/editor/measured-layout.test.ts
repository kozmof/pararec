import { describe, expect, it } from "vitest";
import {
  MeasuredLayout,
  estimateLineHeight,
  captureScrollAnchor,
  anchorScrollTop,
  spliceScrollAnchor,
} from "./vertical-layout.js";

describe("measured layout", () => {
  it("maps heights, prefix offsets, and exact boundaries", () => {
    const heights = [20, 60, 30];
    const layout = new MeasuredLayout(3, (line) => heights[line]);
    expect(layout.totalHeight).toBe(110);
    expect([0, 1, 2, 3].map((line) => layout.top(line))).toEqual([0, 20, 80, 110]);
    expect([-5, 0, 19, 20, 79, 80, 109, 110, 1000].map((y) => layout.lineAt(y))).toEqual([
      0, 0, 0, 1, 1, 2, 2, 2, 2,
    ]);
    expect(layout.setHeight(1, 40)).toBe(true);
    expect(layout.setHeight(1, 40)).toBe(false);
    expect(layout.totalHeight).toBe(90);
    expect(layout.top(2)).toBe(60);
    expect(layout.lineAt(60)).toBe(2);
  });

  it("preserves measured heights outside a splice and estimates new lines", () => {
    const layout = new MeasuredLayout(4, (line) => 20 + line);
    layout.setHeight(0, 50);
    layout.setHeight(3, 60);
    layout.splice(1, 2, 3);
    expect(layout.lineCount).toBe(5);
    expect([0, 1, 2, 3, 4].map((line) => layout.height(line))).toEqual([50, 21, 22, 23, 60]);
    layout.splice(1, 3, 0);
    expect(layout.totalHeight).toBe(110);
    layout.splice(0, 2, 0);
    expect(layout.lineCount).toBe(1);
    expect(layout.totalHeight).toBe(20);
  });

  it("replaces old width estimates and validates height and splice inputs", () => {
    let width = 30;
    const layout = new MeasuredLayout(2, () => estimateLineHeight("abcdef", width, 10));
    expect(layout.totalHeight).toBe(80);
    layout.setHeight(0, 100);
    width = 60;
    layout.resetEstimates();
    expect(layout.totalHeight).toBe(40);
    expect(() => layout.setHeight(0, 0)).toThrow(RangeError);
    expect(() => layout.setHeight(2, 20)).toThrow(RangeError);
    expect(() => layout.splice(0, 3, 0)).toThrow(RangeError);
    expect(() => new MeasuredLayout(2, () => NaN)).toThrow(RangeError);
    expect(estimateLineHeight("", 100)).toBe(20);
    expect(estimateLineHeight("long text", 1, 10, 20, false)).toBe(20);
  });

  it("agrees with a naive model across deterministic height changes and splices", () => {
    const heights = Array.from({ length: 50 }, () => 20);
    const layout = new MeasuredLayout(50);
    let seed = 12345;
    const random = (max: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % max;
    };
    for (let edit = 0; edit < 200; edit++) {
      if (edit % 3) {
        const line = random(heights.length),
          height = 10 + random(90);
        heights[line] = height;
        layout.setHeight(line, height);
      } else {
        const line = random(heights.length),
          removed = random(Math.min(4, heights.length - line) + 1),
          inserted = random(4);
        heights.splice(line, removed, ...Array.from({ length: inserted }, () => 20));
        if (!heights.length) heights.push(20);
        layout.splice(line, removed, inserted);
      }
      let top = 0;
      heights.forEach((height, line) => {
        expect(layout.top(line)).toBe(top);
        expect(layout.lineAt(top)).toBe(line);
        expect(layout.lineAt(top + height - 0.5)).toBe(line);
        top += height;
      });
      expect(layout.totalHeight).toBe(top);
    }
  });
});

describe("scroll anchoring", () => {
  it("keeps the same line and pixel offset when a preceding line changes height", () => {
    const layout = new MeasuredLayout(5);
    const anchor = captureScrollAnchor(layout, 55, 8);
    expect(anchor).toEqual({ line: 2, offset: 7 });
    layout.setHeight(0, 60);
    expect(anchorScrollTop(layout, anchor, 8)).toBe(95);
    layout.setHeight(4, 100);
    expect(anchorScrollTop(layout, anchor, 8)).toBe(95);
  });

  it("follows the surviving anchor line through insertion and deletion", () => {
    const layout = new MeasuredLayout(5);
    const anchor = captureScrollAnchor(layout, 68, 8);
    layout.splice(0, 1, 3);
    const inserted = spliceScrollAnchor(anchor, 0, 1, 3, layout.lineCount);
    expect(inserted.line).toBe(5);
    expect(anchorScrollTop(layout, inserted, 8)).toBe(108);
    layout.splice(2, 4, 1);
    const removed = spliceScrollAnchor(inserted, 2, 6, 3, layout.lineCount);
    expect(removed.line).toBe(2);
    expect(anchorScrollTop(layout, removed, 8)).toBe(48);
  });
});
