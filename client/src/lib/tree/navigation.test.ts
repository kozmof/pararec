import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseSchema } from "../../schema.js";
import { buildIndex } from "./index.js";
import { containerPath, levelAt, pathFromHash, pathHash, validPath } from "./navigation.js";
const schema = parseSchema(JSON.parse(readFileSync("fixtures/three-levels.json", "utf8")));
it("validates ancestor chains and truncates the first invalid segment", () => {
  expect(validPath(schema, ["root", "child", "missing", "grandchild"])).toEqual(["root", "child"]);
  expect(validPath(schema, ["child"])).toEqual([]);
  expect(validPath(schema, ["root", "grandchild"])).toEqual(["root"]);
  expect(levelAt(schema, ["root", "child"])[0].id).toBe("grandchild");
});
it("builds paths for nested Containers", () => {
  expect(containerPath(buildIndex(schema), "grandchild")).toEqual(["root", "child", "grandchild"]);
});
it("round trips ids with URL-sensitive characters and stops at malformed escapes", () => {
  expect(pathFromHash(pathHash(["a/b", "日本", "#%"]))).toEqual(["a/b", "日本", "#%"]);
  expect(pathFromHash("#/c/root/%ZZ/child")).toEqual(["root"]);
  expect(pathHash([])).toBe("#/");
});
