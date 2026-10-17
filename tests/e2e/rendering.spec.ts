import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));

test("Markdown previews retain list bullets and heading styles after the CSS reset", async ({
  page,
}) => {
  const disk = structuredClone(fixture);
  disk.root[1].right.text = "#test\n\n- abc\n- def";
  await page.route("**/api/document", async (route) => {
    if (route.request().method() === "PUT") disk.root = route.request().postDataJSON().root;
    await route.fulfill({ json: disk, headers: { ETag: '"v1"' } });
  });
  await page.goto("/");
  await expect(page.getByTestId("editor-sink")).toBeFocused();
  const cell = page.locator('[data-content-id="flat-2-right"]');
  await cell.click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Markdown", exact: true }).click();
  const preview = cell.locator('[data-render-type="markdown"]');
  await expect(preview.locator("ul > li")).toHaveText(["abc", "def"]);
  await expect(preview.locator("ul")).toHaveCSS("list-style-type", "disc");
  await expect(preview.locator("ul")).toHaveCSS("padding-inline-start", /[1-9][0-9.]*px/);
  await expect(preview.locator("p").first()).toHaveText("#test");

  await expect.poll(() => disk.root[1].right.renderType).toBe("markdown");
  disk.root[1].right.text = "# test\n\n1. abc\n2. def\n\n> quote\n\n[link](https://example.com)";
  await page.reload();
  await expect(preview.locator("h1")).toHaveText("test");
  await expect(preview.locator("h1")).toHaveCSS("font-weight", "600");
  await expect(preview.locator("h1")).toHaveCSS("font-size", "32px");
  await expect(preview.locator("ol")).toHaveCSS("list-style-type", "decimal");
  await expect(preview.locator("blockquote")).toHaveCSS("border-inline-start-width", "3px");
  await expect(preview.locator("a")).toHaveCSS("text-decoration-line", "underline");
});

test("display formulas scroll horizontally without vertical scroll controls", async ({ page }) => {
  const disk = structuredClone(fixture);
  const formula = String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
  disk.root[0].right.renderType = "markdown";
  disk.root[0].right.text = `## Quadratic formula\n\n$$\n${formula}\n$$`;
  disk.root[1].right.renderType = "katex";
  disk.root[1].right.text = formula;
  await page.route("**/api/document", (route) =>
    route.fulfill({ json: disk, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: "Document title" }).click();
  for (const type of ["markdown", "katex"]) {
    const display = page.locator(`[data-render-type="${type}"] .katex-display`);
    await expect(display).toBeVisible();
    await expect(display).toHaveCSS("overflow-x", "auto");
    await expect(display).toHaveCSS("overflow-y", "hidden");
    const bounds = await display.evaluate((element) => {
      const outer = element.getBoundingClientRect();
      const formula = element.querySelector(".katex-html")!.getBoundingClientRect();
      return { top: formula.top - outer.top, bottom: outer.bottom - formula.bottom };
    });
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeGreaterThanOrEqual(0);
  }
});
