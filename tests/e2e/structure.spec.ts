import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Schema } from "../../client/src/schema.js";
const fixture: Schema = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("structure shortcuts build and rearrange notes with valid saved snapshots", async ({
  page,
}) => {
  let disk = structuredClone(fixture),
    etag = '"v1"';
  await page.route("**/api/document", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: disk, headers: { ETag: etag } });
      return;
    }
    if (route.request().headers()["if-match"] !== etag) {
      await route.fulfill({ status: 412 });
      return;
    }
    disk = route.request().postDataJSON();
    etag = `"${Date.now()}"`;
    await route.fulfill({ status: 204, headers: { ETag: etag } });
  });
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("Home");
  for (let column = 0; column < 6; column++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root.map((row) => row.right.text)).toEqual(["First ", "!note", "Second note"]);
  const inserted = disk.root[1].id;
  await page.keyboard.press("Alt+ArrowUp");
  await expect(
    page.locator(`[data-container-id="${inserted}"]`).getByTestId("editor-sink"),
  ).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(new RegExp(`#/c/${inserted}/`));
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("日本");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root[0].right.children[0].right.children[0].right.text).toBe("日本");
});
