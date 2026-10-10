import { expect, it } from "vitest";
import { LineIdentity } from "./line-identity.js";

const lines = (text: string, start = 0) =>
  text.split("\n").map((content, at) => ({ lineNumber: start + at, content }));

it("keeps unaffected line keys through a split and a join", () => {
  const identity = new LineIdentity();
  const before = identity.reconcile(lines("one\ntwo\nthree"));
  const split = identity.reconcile(lines("o\nne\ntwo\nthree"));
  expect(split[0].key).toBe(before[0].key);
  expect(split.slice(2).map((line) => line.key)).toEqual(before.slice(1).map((line) => line.key));
  expect(split[2].lineNumber).toBe(2);
  const joined = identity.reconcile(lines("one\ntwo\nthree"));
  expect(joined.map((line) => line.key)).toEqual(before.map((line) => line.key));
});

it("assigns unique keys to repeated blank lines and multiline replacements", () => {
  const identity = new LineIdentity();
  for (const text of ["\n\nlast", "\n\n\nlast", "first\nlast", "", "\n"]) {
    const rendered = identity.reconcile(lines(text));
    expect(new Set(rendered.map((line) => line.key)).size).toBe(rendered.length);
    expect(rendered.map((line) => line.content).join("\n")).toBe(text);
  }
});

it("updates line numbers without losing identity when the visible window moves", () => {
  const identity = new LineIdentity();
  const before = identity.reconcile(lines("one\ntwo\nthree", 10));
  const after = identity.reconcile(lines("two\nthree\nfour", 11));
  expect(after[0].key).toBe(before[1].key);
  expect(after[1].key).toBe(before[2].key);
  expect(after.map((line) => line.lineNumber)).toEqual([11, 12, 13]);
});

it("preserves a clipped window's line identities through newline insertion and deletion", () => {
  const identity = new LineIdentity();
  const before = identity.reconcile(lines("one\ntwo\nthree"));
  identity.splice(0, 1, 2);
  const split = identity.reconcile(lines("o\nne\ntwo"));
  expect(split[2].key).toBe(before[1].key);
  identity.splice(0, 2, 1);
  const joined = identity.reconcile(lines("one\ntwo\nthree"));
  expect(joined[1].key).toBe(before[1].key);
});
