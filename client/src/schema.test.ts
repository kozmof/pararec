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
