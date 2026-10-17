import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Schema } from "../../client/src/schema.js";
const fixture: Schema = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("mounted cells remain editable after exceeding the idle editor cache limit", async ({
  page,
}) => {
  let disk = {
    ...structuredClone(fixture),
    root: Array.from({ length: 60 }, (_, i) => ({
      id: `row-${i}`,
      left: [{ id: `left-${i}`, text: `Left ${i}` }],
      right: { id: `right-${i}`, text: `Right ${i}`, children: [] },
    })),
  };
  await page.route("**/api/document", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: disk, headers: { ETag: '"v1"' } });
    } else {
      disk = route.request().postDataJSON();
      await route.fulfill({ status: 204, headers: { ETag: '"v2"' } });
    }
  });
  await page.goto("/");
  for (const i of [0, 59, 0]) {
    await page.locator(`[data-content-id="right-${i}"]`).click();
    await expect(page.getByTestId("editor-sink")).toBeFocused();
    // Home is intentionally unsupported. Select all to put the caret at the end,
    // then use supported arrow keys to reach the start before inserting.
    const text = await page
      .locator(`[data-content-id="right-${i}"] [data-line]`)
      .first()
      .textContent();
    await page.keyboard.press("ControlOrMeta+a");
    for (let column = 0; column < text!.length; column++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("!");
  }
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root[0].right.text).toBe("!!Right 0");
  expect(disk.root[59].right.text).toBe("!Right 59");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-content-id="right-0"]')).toContainText("!Right 0");
});

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
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-content-id="flat-1-right"]')).toContainText("abc!?First note");
});
