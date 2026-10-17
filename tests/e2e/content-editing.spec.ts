import { composition } from "./composition.js";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
const fixture = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("Japanese composition saves, survives reload, and handles an external conflict", async ({
  page,
}) => {
  let disk = structuredClone(fixture),
    etag = '"v1"';
  disk.root[0].right.text = "note";
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
    etag = '"v2"';
    await route.fulfill({ status: 204, headers: { ETag: etag } });
  });
  await page.goto("/");
  let sink = page.getByTestId("editor-sink");
  await expect(sink).toBeFocused();
  await composition(sink, "compositionstart", "");
  await composition(sink, "compositionupdate", "にほんご");
  await expect(page.locator("[data-preedit]")).toHaveText("にほんご");
  await composition(sink, "compositionend", "日本語");
  await expect(page.getByTestId("editor-surface").locator('[data-line="0"]')).toHaveText(
    "日本語note",
  );
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root[0].right.text).toBe("日本語note");
  await page.reload();
  sink = page.getByTestId("editor-sink");
  await expect(sink).toBeFocused();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toContainText("日本語note");
  disk.root[0].right.text = "External";
  etag = '"external"';
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("dialog", { name: "File changed on disk" })).toBeVisible();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(sink).toBeFocused();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toHaveText("External");
});

test("read-only and focused notes have identical wrapping and click placement", async ({
  page,
}) => {
  const disk = structuredClone(fixture);
  disk.root[1].right.text = "日本語の文章 English 👩‍🚀 を折り返します。".repeat(10);
  await page.route("**/api/document", (route) =>
    route.fulfill({ json: disk, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  const note = page.locator('[data-content-id="flat-2-right"]');
  const before = await note.boundingBox();
  const target = await note.locator('[data-line="0"]').evaluate((el) => {
    const text = el.querySelector("[data-from]")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await expect(note.getByTestId("editor-sink")).toBeFocused();
  await expect.poll(async () => (await note.boundingBox())!.height).toBe(before!.height);
  await page.keyboard.type("!");
  await expect(note).toContainText(`${disk.root[1].right.text.slice(0, 3)}!`);
});

test("failed edits stay in memory until the page reloads", async ({ page }) => {
  await page.route("**/api/document", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500 })
      : route.fulfill({ json: fixture, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.keyboard.type("Unsaved ");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toContainText(
    "Unsaved First note",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toHaveText("First note");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const side of ["left", "right"] as const) {
  test(`clicking blank space in a shorter ${side} cell focuses its input`, async ({ page }) => {
    const disk = structuredClone(fixture);
    disk.root[0].left[0].text = side === "left" ? "Short" : "One\nTwo\nThree";
    disk.root[0].right.text = side === "right" ? "Short" : "One\nTwo\nThree";
    await page.route("**/api/document", (route) =>
      route.fulfill({ json: disk, headers: { ETag: '"v1"' } }),
    );
    await page.goto("/");
    await expect(page.getByTestId("editor-sink")).toBeFocused();
    const cell = page.locator(`[data-container-id="flat-1"] > .${side}-cell`);
    const note = page.locator(`[data-content-id="flat-1-${side}"]`);
    for (let click = 0; click < 2; click++) {
      const box = (await cell.boundingBox())!;
      await page.mouse.click(box.x + box.width - 20, box.y + box.height - 10);
      await expect(note.getByTestId("editor-sink")).toBeFocused();
      await page.keyboard.type("!");
      await expect(note).toHaveText(`Short${"!".repeat(click + 1)}`);
    }
  });
}

for (const side of ["left", "right"] as const) {
  test(`first left-click drag selects text in an inactive ${side} note`, async ({ page }) => {
    const disk = structuredClone(fixture);
    const target = side === "left" ? disk.root[1].left[0] : disk.root[1].right;
    target.text = "abcdefghij";
    await page.route("**/api/document", (route) =>
      route.fulfill({ json: disk, headers: { ETag: '"v1"' } }),
    );
    await page.goto("/");
    await expect(page.getByTestId("editor-sink")).toBeFocused();
    const note = page.locator(`[data-content-id="${target.id}"]`);
    const points = await note.locator('[data-line="0"]').evaluate((el) => {
      const text = el.querySelector("[data-from]")!.firstChild!;
      return [2, 6].map((column) => {
        const range = document.createRange();
        range.setStart(text, column);
        range.collapse(true);
        const box = range.getBoundingClientRect();
        return { x: box.left, y: box.top + box.height / 2 };
      });
    });
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 5 });
    await page.mouse.up();
    await expect(note.getByTestId("editor-sink")).toBeFocused();
    await page.keyboard.insertText("!");
    await expect(note.locator('[data-line="0"]')).toHaveText("ab!ghij");
  });
}
