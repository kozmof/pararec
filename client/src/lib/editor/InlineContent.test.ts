import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import InlineContent from "./InlineContent.svelte";
import { domLineMeasurer } from "./line-measurer.js";

test("renders a label with small numbered destinations while keeping measurement on source text", async () => {
  const follow = vi.fn();
  const { container } = render(InlineContent, {
    text: "text1 foo text2",
    line: 0,
    decorations: [
      {
        id: "link",
        kind: "link",
        start: { line: 0, column: 6 },
        end: { line: 0, column: 9 },
        destinations: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ],
      },
    ],
    onDestination: follow,
  });
  expect(container.querySelector(".link-label")).toHaveTextContent("foo");
  expect([...container.querySelectorAll("[data-from]")].map((el) => el.textContent).join("")).toBe(
    "text1 foo text2",
  );
  expect(container.querySelector("[data-editor-annotation]")).toHaveTextContent("1,2,3");
  const measure = domLineMeasurer(() => container);
  const text = container.querySelector('[data-from="9"]')!.firstChild;
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: () => ({ offsetNode: text, offset: 6 }),
  });
  try {
    expect(measure.pointToColumn(0, 10, 0)).toBe(15);
  } finally {
    Reflect.deleteProperty(document, "caretPositionFromPoint");
  }
  await fireEvent.click(screen.getByRole("button", { name: "Linked cell 2: Beta" }));
  expect(follow).toHaveBeenCalledWith("b");
});

test("destination glyphs do not introduce extra measured text rows", () => {
  const { container } = render(InlineContent, {
    text: "abc def",
    line: 0,
    decorations: [
      {
        id: "link",
        kind: "link",
        start: { line: 0, column: 0 },
        end: { line: 0, column: 3 },
        destinations: [{ id: "a", label: "Alpha" }],
      },
    ],
  });
  const descriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
  const rect = (top: number) => ({ left: 0, top, width: 20, height: 15 }) as DOMRect;
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      return this.startContainer === this.endContainer ? [rect(0)] : [rect(0), rect(3)];
    },
  });
  try {
    const measure = domLineMeasurer(() => container);
    expect(measure.visualRows(0)).toEqual([{ top: 0, height: 20 }]);
    expect(measure.rangeRects(0, 0, 7)).toHaveLength(1);
  } finally {
    if (descriptor) Object.defineProperty(Range.prototype, "getClientRects", descriptor);
    else Reflect.deleteProperty(Range.prototype, "getClientRects");
  }
});
