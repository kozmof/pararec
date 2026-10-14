import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("splitting linked Unicode text preserves both labels through history and saving", async ({ page }) => {
  let disk = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));
  disk.root[0].right.text = "日本abcd";
  disk.links = [{ id: "cross", sourceId: "flat-1-right", start: 3, end: 8, targets: ["flat-2-right"] }];
  await page.route("**/api/document", async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: disk, headers: { ETag: '"test"' } });
    else { disk = route.request().postDataJSON(); await route.fulfill({ status: 204, headers: { ETag: '"test"' } }); }
  });
  await page.goto("/");
  const source = page.locator('[data-content-id="flat-1-right"]');
  await expect(source.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByRole("button", { name: /Linked cell 1:/ })).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("button", { name: /Linked cell 1:/ })).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("button", { name: /Linked cell 1:/ })).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.links).toEqual(expect.arrayContaining([
    { id: "cross", sourceId: "flat-1-right", start: 3, end: 6, targets: ["flat-2-right"] },
    expect.objectContaining({ sourceId: disk.root[1].right.id, start: 0, end: 2, targets: ["flat-2-right"] }),
  ]));
  await page.reload();
  await expect(page.getByRole("button", { name: /Linked cell 1:/ })).toHaveCount(2);
});

test("selected text links to cells in read-only mode, persists, and supports history", async ({ page }) => {
  let disk = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));
  disk.root[0].right.text = "First";
  await page.route("**/api/document", async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: disk, headers: { ETag: '"test"' } });
    else { disk = route.request().postDataJSON(); await route.fulfill({ status: 204, headers: { ETag: '"test"' } }); }
  });
  await page.goto("/");
  const source = page.locator('[data-content-id="flat-1-right"]');
  const target = page.locator('[data-content-id="flat-2-right"]');
  await expect(source.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await source.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Start linking" }).click();
  await expect(page.getByTestId("editor-sink")).toHaveCount(0);
  await target.click();
  await expect(target).toHaveClass(/chosen/);
  await page.keyboard.type("should not edit");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(source.getByRole("button", { name: /Linked cell 1:/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(source.getByRole("button", { name: /Linked cell 1:/ })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(source.getByRole("button", { name: /Linked cell 1:/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.links[0]).toMatchObject({ sourceId: "flat-1-right", start: 0, end: 5, targets: ["flat-2-right"] });
  await page.reload();
  await source.getByRole("button", { name: /Linked cell 1:/ }).click();
  await expect(target.getByTestId("editor-sink")).toBeFocused();
});
