import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
const fixture = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("Japanese composition saves, survives reload, and handles an external conflict", async ({
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
    etag = '"v2"';
    await route.fulfill({ status: 204, headers: { ETag: etag } });
  });
  await page.goto("/");
  let sink = page.getByTestId("editor-sink");
  await expect(sink).toBeFocused();
  await sink.dispatchEvent("compositionstart");
  await sink.dispatchEvent("compositionupdate", { data: "にほん" });
  await sink.dispatchEvent("compositionend", { data: "日本" });
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root[0].right.text).toBe("日本First note");
  await page.reload();
  sink = page.getByTestId("editor-sink");
  await expect(sink).toBeFocused();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toContainText("日本First note");
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

test("a failed save can be recovered after reload from IndexedDB", async ({ page }) => {
  let offline = false;
  await page.route("**/api/document", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: offline ? 500 : 204, headers: { ETag: '"v2"' } })
      : route.fulfill({ json: fixture, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  offline = true;
  await page.keyboard.type("Recovered ");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("pararec-recovery", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const value = await new Promise<unknown>((resolve) => {
          const request = database
            .transaction("documents")
            .objectStore("documents")
            .get(`${location.origin}/api/document`);
          request.onsuccess = () => resolve(request.result);
        });
        database.close();
        return !!value;
      }),
    )
    .toBe(true);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Recover unsaved notes" })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toContainText(
    "Recovered First note",
  );
});

for (const side of ["left", "right"] as const) {
  test(`clicking blank space in a shorter ${side} cell focuses its input`, async ({ page }) => {
    const disk = structuredClone(fixture);
    disk.root[0].left[0].text = side === "left" ? "Short" : "One\nTwo\nThree";
    disk.root[0].right.text = side === "right" ? "Short" : "One\nTwo\nThree";
    await page.route("**/api/document", route =>
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
