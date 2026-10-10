import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSchema } from "./schema";

const row = {
  id: "row",
  left: [{ id: "left", text: "" }],
  right: { id: "right", text: "", children: [] },
};

describe("file format", () => {
  it.each(["empty", "flat", "three-levels", "long"])(
    "loads the %s fixture without changing it",
    (name) => {
      const value = JSON.parse(readFileSync(`fixtures/${name}.json`, "utf8"));
      expect(parseSchema(value)).toEqual(value);
    },
  );
  it("normalizes line breaks and discards unknown fields", () => {
    const result = parseSchema({
      version: 1,
      future: true,
      root: [{ ...row, right: { ...row.right, text: "a\r\nb\rc", future: 1 } }],
    });
    expect(result).toEqual({
      title: "document",
      config: {
        showTitles: true, maxWidth: 1100,
        outerWidthRate: { left: 35, right: 65 },
        innerIdthRate: { left: 35, right: 65 },
      },
      version: 1,
      root: [{ ...row, right: { ...row.right, text: "a\nb\nc" } }],
    });
  });
  it.each([
    null,
    { version: 2, root: [] },
    { version: 1, root: [{ ...row, left: [] }] },
    { version: 1, root: [{ ...row, right: { ...row.right, id: "row" } }] },
    {
      version: 1,
      root: [{ ...row, right: { ...row.right, children: [{ ...row, id: "nested" }] } }],
    },
    { version: 1, root: [{ ...row, left: [{ id: "left", text: 123 }] }] },
    { version: 1, root: [{ ...row, right: { id: "right", text: "" } }] },
  ])("rejects invalid input %#", (input) => {
    expect(() => parseSchema(input)).toThrow();
  });
});

it("preserves document settings", () => {
  const value = {
    version: 1,
    root: [],
    title: "My notes",
    config: {
      showTitles: false, maxWidth: 1100,
      outerWidthRate: { left: 2, right: 3 },
      innerIdthRate: { left: 1, right: 4 },
    },
  };
  expect(parseSchema(value)).toEqual(value);
});

it.each([
  { title: 123 },
  { config: { showTitles: "false" } },
  { config: { outerWidthRate: { left: 0, right: 1 } } },
  { config: { innerIdthRate: { left: 1, right: Infinity } } },
  { config: { outerWidthRate: { left: 1 } } },
])("rejects invalid settings %j", (settings) => {
  expect(() => parseSchema({ version: 1, root: [], ...settings })).toThrow();
});

it("populates required title and configuration for legacy files", () => {
  expect(parseSchema({ version: 1, root: [] }, "my.notes")).toEqual({
    version: 1,
    title: "my.notes",
    config: {
      showTitles: true, maxWidth: 1100,
      outerWidthRate: { left: 35, right: 65 },
      innerIdthRate: { left: 35, right: 65 },
    },
    root: [],
  });
});

it.each([0, -1, Infinity, NaN, "900px", null])("rejects invalid maxWidth %s", maxWidth => {
  expect(() => parseSchema({ version: 1, root: [], config: { maxWidth } })).toThrow();
});

it("uses the existing width for older configs and preserves a custom width", () => {
  expect(parseSchema({ version: 1, root: [] }).config.maxWidth).toBe(1100);
  expect(parseSchema({ version: 1, root: [], config: { maxWidth: 900 } }).config.maxWidth).toBe(900);
});
