import type { Locator } from "@playwright/test";

/** Playwright's generic dispatchEvent does not construct CompositionEvent or retain data. */
export async function composition(
  sink: Locator,
  type: "compositionstart" | "compositionupdate" | "compositionend",
  data = "",
): Promise<void> {
  await sink.evaluate((node, event) => {
    node.dispatchEvent(new CompositionEvent(event.type, {
      bubbles: true,
      cancelable: true,
      data: event.data,
    }));
  }, { type, data });
}
