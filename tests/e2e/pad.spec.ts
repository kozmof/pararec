import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
const fixture = JSON.parse(readFileSync("fixtures/three-levels.json", "utf8"));

test("nested levels support mouse, keyboard, reload, and browser history", async ({ page }) => {
  await page.route("**/api/document", (route) =>
    route.fulfill({ json: fixture, headers: { ETag: '"fixture"' } }),
  );
  await page.goto("/");
  const root = page.locator('[data-content-id="root-right"]');
  const child = page.locator('[data-content-id="child-right"]');
  const grandchild = page.locator('[data-content-id="grandchild-right"]');
  await expect(root).toBeVisible();
  await expect(child).toBeVisible();
  await expect(grandchild).toHaveCount(0);
  await child.focus();
  await page.keyboard.press("ControlOrMeta+.");
  await expect(page).toHaveURL(/#\/c\/root\/child$/);
  await expect(grandchild.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(child.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(root).toBeVisible();
  await expect(child.getByTestId("editor-sink")).toBeFocused();
  await page.getByRole("button", { name: "Go deeper into Child note" }).click();
  await expect(grandchild.getByTestId("editor-sink")).toBeFocused();
  await page.reload();
  await expect(grandchild.getByTestId("editor-sink")).toBeFocused();
  await page.goBack();
  await expect(root).toBeVisible();
  await expect(child).toBeVisible();
  const ratios = await page
    .locator('[data-container-id="root"], [data-container-id="child"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const left = row.firstElementChild!.getBoundingClientRect();
        return left.width / row.getBoundingClientRect().width;
      }),
    );
  for (const ratio of ratios) expect(ratio).toBeCloseTo(0.35, 2);
});

test("invalid ancestor chains are truncated and empty levels accept Enter", async ({ page }) => {
  await page.route("**/api/document", (route) =>
    route.fulfill({ json: fixture, headers: { ETag: '"fixture"' } }),
  );
  await page.goto("/#/c/root/child/missing");
  await expect(page).toHaveURL(/#\/c\/root\/child$/);
  await page.goto("/#/c/root/child/grandchild");
  const add = page.getByRole("button", { name: "Add row" });
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
});
