import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));
const origin = "http://127.0.0.1:4547";
test.beforeEach(async ({ request }) => {
  const loaded = await request.get("/api/document");
  const response = await request.put("/api/document", {
    headers: { Origin: origin, "If-Match": loaded.headers().etag },
    data: fixture,
  });
  expect(response.ok()).toBe(true);
});

test("built application edits, saves, and reloads through the real API", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  await page.keyboard.type("Released ");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-content-id="flat-1-right"]')).toHaveText("Released First note");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
