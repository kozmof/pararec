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

test("rendered math labels keep their navigation and context menu", async ({ page }) => {
  const disk = structuredClone(fixture);
  const source = disk.root[1].right;
  source.renderType = "markdown";
  source.text = "Pythagorean theorem: $a^2 + b^2 = c^2$";
  const target = disk.root[0].left[0].id;
  const start = new TextEncoder().encode(source.text.slice(0, source.text.indexOf("c^2"))).length;
  disk.links = [{ id: "energy", sourceId: source.id, start, end: start + 3, targets: [target] }];
  await page.route("**/api/document", async (route) => {
    if (route.request().method() === "PUT") Object.assign(disk, route.request().postDataJSON());
    await route.fulfill({ json: disk, headers: { ETag: '"v1"' } });
  });
  await page.goto("/");
  const cell = page.locator(`[data-content-id="${source.id}"]`);
  const label = cell.locator('.katex-html .link-label[data-link-ids="energy"]');
  await expect(label).toBeVisible();
  await expect(label).toContainText("c");
  await expect(label).toContainText("2");
  await cell.getByRole("button", { name: "Linked cell 1: Go to linked cell" }).click();
  await expect(
    page.locator(`[data-content-id="${target}"]`).getByTestId("editor-sink"),
  ).toBeFocused();
  await expect(label).toBeVisible();
  await label.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Remove label", exact: true })).toBeVisible();
  await expect(label).toBeVisible();
});

test("two math destinations appear beside their individual labels", async ({ page }) => {
  const disk = structuredClone(fixture);
  const source = disk.root[1].right;
  source.renderType = "katex";
  source.text = "a^2 + b^2 = c^2";
  disk.links = [
    { id: "first", sourceId: source.id, start: 0, end: 3, targets: [disk.root[0].left[0].id] },
    { id: "second", sourceId: source.id, start: 6, end: 9, targets: [disk.root[0].right.id] },
  ];
  await page.route("**/api/document", (route) =>
    route.fulfill({ json: disk, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  const cell = page.locator(`[data-content-id="${source.id}"]`);
  const first = cell.locator('.link-label[data-link-ids="first"]');
  const second = cell.locator('.link-label[data-link-ids="second"]');
  const firstNumber = cell.locator('.destinations[data-link-ids="first"] button');
  const secondNumber = cell.locator('.destinations[data-link-ids="second"] button');
  await expect(firstNumber).toBeVisible();
  await expect(secondNumber).toBeVisible();
  const firstBox = (await first.boundingBox())!,
    secondBox = (await second.boundingBox())!;
  const firstNumberBox = (await firstNumber.boundingBox())!,
    secondNumberBox = (await secondNumber.boundingBox())!;
  expect(firstNumberBox.x).toBeGreaterThanOrEqual(firstBox.x);
  expect(firstNumberBox.x + firstNumberBox.width).toBeLessThan(secondBox.x);
  expect(secondNumberBox.x).toBeGreaterThan(secondBox.x);
  expect(firstNumberBox.y + firstNumberBox.height / 2).toBeGreaterThan(
    firstBox.y + firstBox.height / 2,
  );
  expect(secondNumberBox.y + secondNumberBox.height / 2).toBeGreaterThan(
    secondBox.y + secondBox.height / 2,
  );
  await firstNumber.focus();
  await expect(firstNumber).toBeFocused();
  await expect(cell.locator('[data-render-type="katex"]')).toBeVisible();
});

for (const type of ["markdown", "katex"]) {
  test(`a destination inside the quadratic formula's radical receives pointer clicks in ${type}`, async ({
    page,
  }) => {
    const disk = structuredClone(fixture);
    const source = disk.root[1].right;
    const formula = String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
    source.renderType = type;
    source.text = type === "markdown" ? `$$\n${formula}\n$$` : formula;
    const target = disk.root[0].left[0].id;
    const start = new TextEncoder().encode(source.text.slice(0, source.text.indexOf("b^2"))).length;
    disk.links = [
      { id: "quadratic", sourceId: source.id, start, end: start + 3, targets: [target] },
    ];
    await page.route("**/api/document", (route) =>
      route.fulfill({ json: disk, headers: { ETag: '"v1"' } }),
    );
    await page.goto("/");
    const cell = page.locator(`[data-content-id="${source.id}"]`);
    const destination = cell.locator(".sqrt button[data-render-target]");
    await expect(destination).toBeVisible();
    const receivesClicks = await destination.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && (hit === button || button.contains(hit));
    });
    expect(receivesClicks).toBe(true);
    await destination.click();
    await expect(
      page.locator(`[data-content-id="${target}"]`).getByTestId("editor-sink"),
    ).toBeFocused();
    await expect(cell.locator(`[data-render-type="${type}"]`)).toBeVisible();
  });
}
