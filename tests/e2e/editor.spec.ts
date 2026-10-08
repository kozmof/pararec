import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Schema } from "../../client/src/schema.js";
const fixture: Schema = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));
test.beforeEach(async ({ page }) => {
  let disk = structuredClone(fixture),
    revision = 1;
  await page.route("**/api/document", async (route) => {
    if (route.request().method() === "PUT") {
      disk = route.request().postDataJSON();
      revision++;
      await route.fulfill({ status: 204, headers: { ETag: '"v' + revision + '"' } });
    } else await route.fulfill({ json: disk, headers: { ETag: '"v' + revision + '"' } });
  });
});

test("Japanese text wraps with visual-row navigation and selection", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  const sink = page.getByTestId("editor-sink");
  const line = page.getByTestId("editor-surface").locator('[data-line="0"]');
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

test("pad supports text, selection, undo, and redo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await expect(page.getByRole("main")).toBeVisible();
  const sink = page.getByTestId("editor-sink");
  const line = page.getByTestId("editor-surface").locator('[data-line="0"]');
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

test("pad commits composition once and undoes it as one action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  const sink = page.getByTestId("editor-sink");
  await sink.focus();
  await sink.dispatchEvent("compositionstart", { data: "" });
  await sink.dispatchEvent("compositionupdate", { data: "にほん" });
  await expect(page.locator("[data-preedit]")).toHaveText("にほん");
  await sink.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.getByTestId("editor-surface").locator('[data-line="0"]')).toContainText(
    "First note",
  );
  await sink.dispatchEvent("compositionend", { data: "日本" });
  await expect(page.getByTestId("editor-surface").locator('[data-line="0"]')).toHaveText(
    "日本First note",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("editor-surface").locator('[data-line="0"]')).toHaveText(
    "First note",
  );
  await expect(page.getByTestId("editor-surface").locator('[data-line="0"]')).toHaveText(
    "First note",
  );
});

test("click placement and the IME sink follow span measurements", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  const sink = page.getByTestId("editor-sink");
  const line = page.getByTestId("editor-surface").locator('[data-line="0"]');
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
  const nativeBox = await sink.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const cursor = document.querySelector('[data-testid="editor-cursor"]')!.getBoundingClientRect();
    return {
      height: rect.height,
      width: rect.width,
      lineHeight: getComputedStyle(el).lineHeight,
      dx: rect.left - cursor.left,
      dy: rect.top - cursor.top,
    };
  });
  expect(nativeBox).toMatchObject({ height: 20, width: 2, lineHeight: "20px" });
  expect(Math.abs(nativeBox.dx)).toBeLessThan(1);
  expect(Math.abs(nativeBox.dy)).toBeLessThan(1);
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
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  const sink = page.getByTestId("editor-sink");
  const line = page.getByTestId("editor-surface").locator('[data-line="0"]');
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

test("IME input follows text edges when collapsed caret ranges are empty", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.evaluate(() => {
    const clientRects = Range.prototype.getClientRects;
    const boundingRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getClientRects = function () {
      return this.collapsed ? ([] as unknown as DOMRectList) : clientRects.call(this);
    };
    Range.prototype.getBoundingClientRect = function () {
      return this.collapsed ? new DOMRect() : boundingRect.call(this);
    };
  });
  await page.keyboard.press("End");
  await expect
    .poll(async () =>
      page
        .getByTestId("editor-surface")
        .locator('[data-line="0"]')
        .evaluate((el) => {
          const text = el.querySelector('[data-from="0"]')!.firstChild!;
          const range = document.createRange();
          range.selectNodeContents(text);
          const expected = range.getBoundingClientRect().right;
          const actual = document
            .querySelector('[data-testid="editor-sink"]')!
            .getBoundingClientRect().left;
          return Math.abs(expected - actual);
        }),
    )
    .toBeLessThan(2);
  await page.getByTestId("editor-sink").dispatchEvent("compositionstart");
  await page.getByTestId("editor-sink").dispatchEvent("compositionupdate", { data: "日本" });
  await expect
    .poll(async () =>
      page.locator("[data-preedit]").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const actual = document
          .querySelector('[data-testid="editor-sink"]')!
          .getBoundingClientRect().left;
        return Math.abs(range.getBoundingClientRect().right - actual);
      }),
    )
    .toBeLessThan(2);
});
