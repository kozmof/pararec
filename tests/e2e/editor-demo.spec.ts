import { expect, test } from "@playwright/test";

test("Japanese text wraps with visual-row navigation and selection", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto("/#/editor-demo");
  const sink = page.getByTestId("editor-sink");
  const line = page.locator('[data-line="0"]');
  const text = "日本語の長い文章と English 👩‍🚀 を折り返して編集します。".repeat(8);
  await sink.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await expect(line).toHaveText(text);
  await expect.poll(async () => (await line.boundingBox())!.height).toBeGreaterThan(40);
  await page.keyboard.press("ControlOrMeta+Home");
  const start = (await sink.boundingBox())!;
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => Math.round((await sink.boundingBox())!.y - start.y)).toBe(20);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => page.getByTestId("editor-selection").count()).toBeGreaterThan(0);
  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(() => page.getByTestId("editor-selection").count()).toBeGreaterThan(2);
  const before = (await line.boundingBox())!.height;
  await page.setViewportSize({ width: 350, height: 700 });
  await expect.poll(async () => (await line.boundingBox())!.height).toBeGreaterThan(before);
  await expect(line).toHaveText(text);
  expect(
    await page.getByTestId("editor-surface").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

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

test("grapheme deletion and composition cancellation preserve whole text", async ({ page }) => {
  await page.goto("/#/editor-demo");
  const sink = page.getByTestId("editor-sink");
  const line = page.locator('[data-line="0"]');
  await sink.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("a👩‍🚀b");
  await expect(line).toHaveText("a👩‍🚀b");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect(line).toHaveText("ab");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(line).toHaveText("a👩‍🚀b");
  await page.keyboard.press("ControlOrMeta+a");
  await sink.dispatchEvent("compositionstart", { data: "" });
  await sink.dispatchEvent("compositionupdate", { data: "にほん" });
  await sink.dispatchEvent("compositionend", { data: "" });
  await expect(line).toHaveText("a👩‍🚀b");
});

test("auto-height and read-only modes preserve the text layout", async ({ page }) => {
  await page.goto("/#/editor-demo");
  await page.getByLabel("Fit content height").check();
  const surface = page.getByTestId("editor-surface");
  const sink = page.getByTestId("editor-sink");
  await sink.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second line");
  await expect(surface.locator("[data-line]")).toHaveCount(2);
  await expect.poll(async () => (await surface.boundingBox())!.height).toBe(56);
  const before = await surface.locator('[data-line="1"]').boundingBox();
  await page.getByLabel("Read only", { exact: true }).check();
  await expect(sink).toHaveCount(0);
  await expect(page.getByTestId("editor-cursor")).toHaveCount(0);
  await expect(surface.locator('[data-line="1"]')).toHaveText("second line");
  expect(await surface.locator('[data-line="1"]').boundingBox()).toEqual(before);
  await page.getByLabel("Read only", { exact: true }).uncheck();
  await sink.focus();
  expect(await surface.locator('[data-line="1"]').boundingBox()).toEqual(before);
  await expect
    .poll(async () =>
      surface.evaluate((el) => ({
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflow: getComputedStyle(el).overflowY,
      })),
    )
    .toEqual({ height: 56, scrollHeight: 56, overflow: "visible" });
});
