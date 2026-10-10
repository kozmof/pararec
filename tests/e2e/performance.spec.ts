import { cpus, platform, release, totalmem } from "node:os";
import { expect, test } from "@playwright/test";
import type { Schema } from "../../client/src/schema.js";
function fixture(rows: number, lines = 1): Schema {
  return {
    version: 1,
    title: "document",
    config: {
      showTitles: true, maxWidth: 1100,
      outerWidthRate: { left: 35, right: 65 },
      innerIdthRate: { left: 35, right: 65 },
    },
    root: Array.from({ length: rows }, (_, i) => ({
      id: `row-${i}`,
      left: [{ id: `left-${i}`, text: `Left ${i}` }],
      right: {
        id: `right-${i}`,
        text: Array.from({ length: lines }, (_, line) => `Line ${line} 日本 abcdef`).join("\n"),
        children: [],
      },
    })),
  };
}
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
for (const scenario of ["5000-line Content", "50000-line Content", "1000-Container level"] as const) {
  test(`measure ${scenario}`, async ({ page, browser, browserName }, info) => {
    test.skip(process.env.PARAREC_PERFORMANCE !== "1", "Run with pnpm test:performance");
    test.setTimeout(120_000);
    const largeNote = scenario !== "1000-Container level";
    const schema = largeNote ? fixture(1, scenario === "5000-line Content" ? 5000 : 50000) : fixture(1000);
    await page.route("**/api/document", (route) =>
      route.fulfill({ json: schema, headers: { ETag: '"bench"' } }),
    );
    await page.addInitScript(() => {
      performance.mark("pad-navigation-start");
    });
    await page.goto("/");
    await expect(page.getByTestId("editor-sink")).toBeFocused({ timeout: 90_000 });
    const ready = await page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        navigationToReadyMs:
          performance.now() - performance.getEntriesByName("pad-navigation-start")[0].startTime,
        domElements: document.querySelectorAll("*").length,
        hardwareConcurrency: navigator.hardwareConcurrency,
        viewport: { width: innerWidth, height: innerHeight },
        userAgent: navigator.userAgent,
      };
    });
    if (largeNote) expect(await page.locator('[data-testid="editor-surface"] [data-line]').count()).toBeLessThan(150);
    const durations =
      largeNote
        ? await page.evaluate(async () => {
            const sink = document.querySelector<HTMLTextAreaElement>(
              '[data-testid="editor-sink"]',
            )!;
            const surface = document.querySelector('[data-testid="editor-surface"]')!;
            const samples: number[] = [];
            for (let i = 0; i < 105; i++) {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              const duration = await new Promise<number>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  observer.disconnect();
                  reject(new Error("Input did not render"));
                }, 5000);
                const observer = new MutationObserver((records) => {
                  if (
                    !records.some(
                      (record) => record.type === "characterData" || record.type === "childList",
                    )
                  )
                    return;
                  clearTimeout(timeout);
                  observer.disconnect();
                  resolve(performance.now() - start);
                });
                observer.observe(surface, { subtree: true, characterData: true, childList: true });
                const start = performance.now();
                sink.value = "x";
                sink.dispatchEvent(
                  new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }),
                );
              });
              if (i >= 5) samples.push(duration);
            }
            return samples;
          })
        : [];
    const report = {
      scenario,
      date: new Date().toISOString(),
      browser: browserName,
      browserVersion: browser.version(),
      host: {
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
      },
      ...ready,
      renderScope:
        "Navigation start through editor focus and two animation frames, including fixture fetch and development build",
      inputScope:
        "Synthetic textarea input dispatch through DOM mutation observer delivery, including tree update and history recording, excluding physical input, native IME and paint",
      warmup: 5,
      samples: durations.length,
      inputMs: durations.length
        ? {
            p50: percentile(durations, 0.5),
            p95: percentile(durations, 0.95),
            p99: percentile(durations, 0.99),
            max: Math.max(...durations),
            targetMs: 8,
            p95MeetsTarget: percentile(durations, 0.95) < 8,
          }
        : null,
    };
    await info.attach("performance.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    console.log(JSON.stringify(report));
  });
}
