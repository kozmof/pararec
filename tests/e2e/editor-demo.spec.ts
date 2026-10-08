import { expect, test } from "@playwright/test";

test("editor demo supports text, selection, undo, and redo", async ({ page }) => {
  await page.goto("/#/editor-demo");
  await expect(page.getByRole("heading", { name: "Editor demo" })).toBeVisible();
  const sink = page.getByTestId("editor-sink");
  const line = page.locator('[data-line="0"]');
  await sink.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  await expect(line).toHaveText("First note!");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(line).toHaveText("First note");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(line).toHaveText("First note!");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("editor-selection")).toHaveCount(1);
  await page.keyboard.type("replacement");
  await expect(line).toHaveText("replacement");
});

test("editor demo commits composition once and resets when leaving", async ({ page }) => {
  await page.goto("/#/editor-demo");
  const sink = page.getByTestId("editor-sink");
  await sink.focus();
  await sink.dispatchEvent("compositionstart", { data: "" });
  await sink.dispatchEvent("compositionupdate", { data: "にほん" });
  await expect(page.locator("[data-preedit]")).toHaveText("にほん");
  await sink.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.locator('[data-line="0"]')).toContainText("First note");
  await sink.dispatchEvent("compositionend", { data: "日本" });
  await expect(page.locator('[data-line="0"]')).toHaveText("日本First note");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-line="0"]')).toHaveText("First note");
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: "Open editor demo" }).click();
  await expect(page.locator('[data-line="0"]')).toHaveText("First note");
});
