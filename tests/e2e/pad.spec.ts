import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
const fixture = JSON.parse(readFileSync("fixtures/three-levels.json", "utf8"));

test("nested levels support navigation controls, reload, and browser history", async ({ page }) => {
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
  await page.getByRole("button", { name: "Go deeper into Child note" }).click();
  await expect(page).toHaveURL(/#\/c\/root\/child$/);
  await expect(grandchild.getByTestId("editor-sink")).toBeFocused();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(child.getByTestId("editor-sink")).toBeFocused();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("button", { name: "Go back" })).toHaveCount(0);
  await expect(root).toBeVisible();
  await expect(child.getByTestId("editor-sink")).toBeFocused();
  const deeper = page.getByRole("button", { name: "Go deeper into Child note" });
  await deeper.hover();
  await page.mouse.down();
  await expect(child.getByTestId("editor-sink")).toBeFocused();
  await page.mouse.up();
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

test("mixed deep jumps return through visited layers after revisiting the deepest view", async ({ page }) => {
  const deep = JSON.parse(readFileSync("fixtures/seven-levels.json", "utf8"));
  await page.route("**/api/document", route => route.fulfill({ json: deep, headers: { ETag: '"deep"' } }));
  await page.goto("/");
  const hashAt = (depth: number) => depth < 0 ? "#/" : "#/c/" + Array.from({ length: depth + 1 }, (_, i) => `layer-${i}`).join("/");
  const visit = async (depth: number) => {
    await page.locator(`[data-content-id="layer-${depth}-right"]`).focus();
    await expect(page.getByTestId("editor-sink")).toBeFocused();
    await page.getByRole("button", { name: `Go deeper into Layer ${depth + 1} note` }).click();
    await expect(page).toHaveURL(url => url.hash === hashAt(depth));
  };
  for (const depth of [1, 2, 4]) await visit(depth);
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page).toHaveURL(url => url.hash === hashAt(2));
  await expect(page.locator('[data-content-id="layer-4-right"]').getByTestId("editor-sink")).toBeFocused();
  await visit(4);
  for (const depth of [2, 1, -1]) {
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(url => url.hash === hashAt(depth));
    await expect(page.getByRole("status", { name: "Current layer" })).toHaveText(`${depth + 2}:7`);
    await expect(page.getByTestId("editor-sink")).toBeFocused();
  }
  await expect(page.getByRole("button", { name: "Go back" })).toHaveCount(0);
});
