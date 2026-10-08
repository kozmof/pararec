import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Schema } from "../../client/src/schema.js";
const fixture: Schema = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("undo and redo restore text, structure, and caret and survive saving", async ({ page }) => {
  let disk = structuredClone(fixture),
    revision = 1;
  await page.route("**/api/document", async (route) => {
    const etag = `"v${revision}"`;
    if (route.request().method() === "GET") {
      await route.fulfill({ json: disk, headers: { ETag: etag } });
      return;
    }
    if (route.request().headers()["if-match"] !== etag) {
      await route.fulfill({ status: 412 });
      return;
    }
    disk = route.request().postDataJSON();
    revision++;
    await route.fulfill({ status: 204, headers: { ETag: `"v${revision}"` } });
  });
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("abc");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk).toEqual(fixture);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("editor-sink")).toBeFocused();
  }
  await page.keyboard.type("?");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root.map((row) => row.id)).toEqual(["flat-2", "flat-1"]);
  expect(disk.root[1].right.text).toBe("abc!?First note");
  await page.reload();
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toContainText("abc!?First note");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
