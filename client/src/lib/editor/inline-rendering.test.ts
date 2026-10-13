import { expect, test } from "vitest";
import { inlineRuns, type InlineDecoration } from "./inline-rendering.js";
const link = (id: string, start: number, end: number): InlineDecoration => ({ id, kind: "link", start: { line: 0, column: start }, end: { line: 0, column: end }, destinations: [{ id: "target", label: "Target" }] });

test("segments source text without adding destination numbers to source coordinates", () => {
  const runs = inlineRuns("text1 foo text2", 0, [link("a", 6, 9)]);
  expect(runs.map(run => [run.from, run.to, run.decorations.length, run.endings.length])).toEqual([[0, 6, 0, 0], [6, 9, 1, 1], [9, 15, 0, 0]]);
});
test("supports overlapping ranges without duplicating source text", () => {
  const text = "abcdef";
  const runs = inlineRuns(text, 0, [link("a", 1, 4), link("b", 3, 5)]);
  expect(runs.map(run => text.slice(run.from, run.to)).join("")).toBe(text);
  expect(runs.find(run => run.from === 3)?.decorations.map(item => item.id)).toEqual(["a", "b"]);
  expect(runs.flatMap(run => run.endings.map(item => item.id))).toEqual(["a", "b"]);
});
test("multiline labels show destination numbers only at the final endpoint", () => {
  const decoration = { ...link("a", 1, 2), end: { line: 2, column: 2 } };
  expect(inlineRuns("abc", 0, [decoration]).at(-1)?.decorations).toEqual([decoration]);
  expect(inlineRuns("abc", 1, [decoration])[0].endings).toEqual([]);
  expect(inlineRuns("abc", 2, [decoration])[0].endings).toEqual([decoration]);
});

test("a range ending at the next line start still renders its destinations", () => {
  const decoration = { ...link("a", 1, 2), end: { line: 1, column: 0 } };
  expect(inlineRuns("next", 1, [decoration])[0]).toMatchObject({ from: 0, to: 0, endings: [decoration] });
  expect(inlineRuns("", 1, [decoration])[0].endings).toEqual([decoration]);
});
