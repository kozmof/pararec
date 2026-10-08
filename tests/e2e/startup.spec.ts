import { expect, test } from "@playwright/test";

test("client connects to the local server through the development proxy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pararec" })).toBeVisible();
  await expect(page.getByTestId("pad-level")).toBeVisible();
});

test("development proxy preserves document API preconditions", async ({ request }) => {
  const response = await request.put("/api/document", {
    data: { version: 1, root: [] },
    headers: { origin: "http://127.0.0.1:5173" },
  });
  expect(response.status()).toBe(428);
});

test("development proxy keeps foreign origins rejected", async ({ request }) => {
  const response = await request.put("/api/document", {
    data: { version: 1, root: [] },
    headers: { origin: "http://foreign.example", "if-match": "*" },
  });
  expect(response.status()).toBe(403);
});
