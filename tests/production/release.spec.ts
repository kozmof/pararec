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

for (const recovery of ["restore", "conflict", "discard"] as const) {
  test(`a closed page offers recovery (${recovery})`, async ({ page, context, request }) => {
    await page.route("**/api/document", (route) =>
      route.request().method() === "PUT" ? route.fulfill({ status: 500 }) : route.continue(),
    );
    await page.goto("/");
    await expect(page.getByTestId("editor-sink")).toBeFocused();
    await page.keyboard.type("Recovered ");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
    // Wait for the actual IndexedDB transaction before simulating loss of the tab.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string[]>((resolve, reject) => {
              const open = indexedDB.open("pararec-recovery", 1);
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const database = open.result;
                const tx = database.transaction("drafts", "readonly");
                const drafts = tx.objectStore("drafts").getAll();
                tx.oncomplete = () => {
                  database.close();
                  resolve(drafts.result.map((draft) => draft.schema.root[0].right.text));
                };
                tx.onerror = () => {
                  database.close();
                  reject(tx.error);
                };
              };
            }),
        ),
      )
      .toEqual(["Recovered First note"]);
    await page.close();
    const loaded = await request.get("/api/document");
    if (recovery === "conflict") {
      const external = { ...fixture, title: "Changed externally" };
      expect(
        (
          await request.put("/api/document", {
            headers: { Origin: origin, "If-Match": loaded.headers().etag },
            data: external,
          })
        ).ok(),
      ).toBe(true);
    }
    const reopened = await context.newPage();
    await reopened.goto(origin);
    await expect(reopened.getByRole("dialog", { name: "Recover unsaved notes" })).toBeVisible();
    if (recovery === "discard") {
      await reopened.getByRole("button", { name: "Discard drafts", exact: true }).click();
      await expect(reopened.getByTestId("editor-sink")).toBeFocused();
      await expect(reopened.locator('[data-content-id="flat-1-right"]')).toHaveText("First note");
      await reopened.reload();
      await expect(reopened.getByTestId("editor-sink")).toBeFocused();
      await expect(reopened.getByRole("dialog")).toHaveCount(0);
      return;
    }
    await reopened.getByRole("button", { name: /Restore draft from/ }).click();
    if (recovery === "conflict") {
      await expect(reopened.getByRole("dialog", { name: "File changed on disk" })).toBeVisible();
      expect((await request.get("/api/document")).headers().etag).not.toBe(loaded.headers().etag);
      await reopened.getByRole("button", { name: "Overwrite", exact: true }).click();
    } else {
      await expect(reopened.getByTestId("editor-sink")).toBeFocused();
      await expect(reopened.getByText("Unsaved changes", { exact: true })).toBeVisible();
      expect((await (await request.get("/api/document")).json()).root[0].right.text).toBe(
        "First note",
      );
      await reopened.keyboard.press("ControlOrMeta+s");
    }
    await expect(reopened.getByText("Saved", { exact: true })).toBeVisible();
    await reopened.reload();
    await expect(reopened.locator('[data-content-id="flat-1-right"]')).toHaveText(
      "Recovered First note",
    );
    await expect(reopened.getByRole("dialog")).toHaveCount(0);
  });
}
