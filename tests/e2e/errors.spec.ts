import { expect, test } from "@playwright/test";
for (const scenario of ["offline", "unreadable", "invalid JSON", "invalid schema"] as const) {
  test(`document load recovers after ${scenario}`, async ({ page }) => {
    let fixed = false,
      puts = 0;
    await page.route("**/api/document", async (route) => {
      if (route.request().method() === "PUT") {
        puts++;
        await route.fulfill({ status: 500 });
        return;
      }
      if (fixed) {
        await route.fulfill({ json: { version: 1, root: [] }, headers: { ETag: '"fixed"' } });
        return;
      }
      if (scenario === "offline") await route.abort("connectionrefused");
      else if (scenario === "unreadable") await route.fulfill({ status: 500 });
      else
        await route.fulfill({
          body: scenario === "invalid JSON" ? "{broken" : '{"version":2,"root":[]}',
          headers: { ETag: '"bad"' },
        });
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      scenario === "offline"
        ? "Cannot reach"
        : scenario === "unreadable"
          ? "permissions"
          : "file is invalid",
    );
    await expect(page.getByTestId("editor-sink")).toHaveCount(0);
    expect(puts).toBe(0);
    fixed = true;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add row" })).toBeFocused();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
