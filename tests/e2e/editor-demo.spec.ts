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

test("click placement and the IME sink follow span measurements", async ({ page }) => {
  await page.goto("/#/editor-demo");
  const sink = page.getByTestId("editor-sink");
  const line = page.locator('[data-line="0"]');
  const click = await line.evaluate((el) => {
    const text = el.querySelector("[data-from]")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(click.x, click.y);
  await page.keyboard.type("!");
  await expect(line).toHaveText("First! note");
  await sink.dispatchEvent("compositionstart", { data: "" });
  await sink.dispatchEvent("compositionupdate", { data: "日本" });
  await expect(line.locator("[data-from]")).toHaveCount(3);
  await expect(line.locator("[data-preedit]")).toHaveAttribute("data-from", "6");
  await expect
    .poll(async () =>
      line.evaluate((el) => {
        const suffix = el.querySelector('[data-from="8"]')!.firstChild!;
        const range = document.createRange();
        range.setStart(suffix, 0);
        range.collapse(true);
        const expected = range.getBoundingClientRect().left;
        const actual = document
          .querySelector('[data-testid="editor-sink"]')!
          .getBoundingClientRect().left;
        return Math.abs(expected - actual);
      }),
    )
    .toBeLessThan(2);
  await sink.dispatchEvent("compositionend", { data: "日本" });
  await expect(line).toHaveText("First!日本 note");
});
