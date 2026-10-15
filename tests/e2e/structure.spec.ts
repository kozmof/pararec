import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Schema } from "../../client/src/schema.js";
const fixture: Schema = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("structure shortcuts build and rearrange notes with valid saved snapshots", async ({
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
    etag = `"${Date.now()}"`;
    await route.fulfill({ status: 204, headers: { ETag: etag } });
  });
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  for (let column = 0; column < 6; column++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root.map((row) => row.right.text)).toEqual(["First note", "!", "Second note"]);
  const inserted = disk.root[1].id;
  await page.keyboard.press("Alt+ArrowUp");
  await expect(
    page.locator(`[data-container-id="${inserted}"]`).getByTestId("editor-sink"),
  ).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(new RegExp(`#/c/${inserted}/`));
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("日本");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(disk.root[0].right.children[0].right.children[0].right.text).toBe("日本");
});

for (const active of [false, true]) {
  test(`clicking the left padding of an ${active ? "active" : "inactive"} parent note prepends a child`, async ({ page }) => {
    let disk = JSON.parse(readFileSync("fixtures/three-levels.json", "utf8"));
    await page.route("**/api/document", async route => {
      if (route.request().method() === "GET") await route.fulfill({ json: disk, headers: { ETag: '"test"' } });
      else {
        disk = route.request().postDataJSON();
        await route.fulfill({ status: 204, headers: { ETag: '"test"' } });
      }
    });
    await page.goto("/#/c/root/child");
    await expect(page.getByTestId("editor-sink")).toBeFocused();
    const parent = page.locator('[data-content-id="child-right"]');
    if (active) {
      await parent.focus();
      await expect(parent.getByTestId("editor-sink")).toBeFocused();
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    }
    await parent.locator('[data-line="0"]').click({ position: { x: 1, y: 10 } });
    await expect(parent.getByTestId("editor-sink")).toBeFocused();
    await page.keyboard.press("Shift+Enter");
    await expect(page.getByTestId("pad-level").getByTestId("editor-sink")).toBeFocused();
    await page.keyboard.type("!");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(disk.root).toHaveLength(1);
    expect(disk.root[0].right.children).toHaveLength(1);
    const note = disk.root[0].right.children[0].right;
    expect(note.text).toBe("Child note");
    expect(note.children.map((row: { right: { text: string } }) => row.right.text)).toEqual(["!", "Grandchild note"]);
    await expect(page).toHaveURL(/#\/c\/root\/child$/);
  });
}
