import { describe, expect, it } from "vitest";
import { renderKatex, renderMarkdown } from "./renderers.js";
import type { TextLink } from "../../schema.js";

function link(source: string, label: string, id = "label"): TextLink {
  const from = source.indexOf(label);
  return {
    id,
    sourceId: "source",
    start: new TextEncoder().encode(source.slice(0, from)).length,
    end: new TextEncoder().encode(source.slice(0, from + label.length)).length,
    targets: ["target"],
  };
}
function parse(html: string) {
  const node = document.createElement("div");
  node.innerHTML = html;
  return node;
}

describe("rendered text links", () => {
  it("highlights the selected occurrence using UTF-8 source offsets", () => {
    const source = "日本 👩‍🚀 **bold** and bold";
    const node = parse(renderMarkdown(source, { links: [link(source, "bold")] }));
    expect(node.querySelector("strong .link-label")).toHaveTextContent("bold");
    expect(node.querySelectorAll(".link-label")).toHaveLength(1);
    expect(node.querySelectorAll("button[data-render-target]")).toHaveLength(1);
    expect(node.querySelector("button")).toHaveAttribute("data-render-target", "target");
  });
  it("keeps overlapping labels and emits one set of buttons for each", () => {
    const source = "abc **def** ghi";
    const node = parse(
      renderMarkdown(source, {
        links: [link(source, "abc **def**", "a"), link(source, "def** ghi", "b")],
      }),
    );
    expect(node.querySelector('[data-link-ids="a b"]')).toHaveTextContent("def");
    expect(node.querySelectorAll("button")).toHaveLength(2);
    expect(node.querySelectorAll("strong")).toHaveLength(1);
  });
  it("keeps destination buttons outside Markdown anchors", () => {
    const source = "[**label**](https://example.com)";
    const node = parse(renderMarkdown(source, { links: [link(source, "label")] }));
    expect(node.querySelector("a .link-label")).toHaveTextContent("label");
    expect(node.querySelector("a button")).toBeNull();
    expect(node.querySelectorAll("button")).toHaveLength(1);
  });
  it.each(["markdown", "katex"])(
    "highlights c squared inside %s math without changing the formula",
    (type) => {
      const source = type === "markdown" ? "Energy: $E = mc^2$" : "E = mc^2";
      const options = { links: [link(source, "c^2")] };
      const node = parse(
        type === "markdown" ? renderMarkdown(source, options) : renderKatex(source, true, options),
      );
      const label = node.querySelector(".katex-html .link-label");
      expect(label).toHaveAttribute("data-link-ids", "label");
      expect(label?.textContent).toContain("c");
      expect(label?.textContent).toContain("2");
      expect(label?.textContent).not.toContain("E");
      expect(node.querySelector(".katex-error")).toBeNull();
      expect(node.querySelector("annotation")).toHaveTextContent("E = mc^2");
      expect(node.querySelector("button")?.closest('[aria-hidden="true"]')).toBeNull();
      expect(node.querySelectorAll("button")).toHaveLength(1);
    },
  );
  it("keeps a formula valid when a label splits a TeX command", () => {
    const source = String.raw`\frac{a}{b}`;
    const node = parse(renderKatex(source, true, { links: [link(source, "frac")] }));
    expect(node.querySelector(".katex-error")).toBeNull();
    expect(node.querySelector(".link-label .katex")).not.toBeNull();
    expect(node.querySelectorAll("button")).toHaveLength(1);
  });
  it("labels display math and keeps source delimiters out of the preview", () => {
    const source = "$$\nc^2\n$$";
    const node = parse(renderMarkdown(source, { links: [link(source, "c^2")] }));
    expect(node.querySelector(".katex-display .destinations")).not.toBeNull();
    expect(node.querySelectorAll("button")).toHaveLength(1);
    expect(node.querySelector(".katex-html")).not.toHaveTextContent("$");
  });
  it("escapes link attributes and keeps untrusted TeX extensions disabled", () => {
    const source = String.raw`c^2 + \htmlStyle{color:red}{x}`;
    const unsafe = link(source, "c^2", '"><script>alert(1)</script>');
    const node = parse(
      renderKatex(source, true, {
        links: [{ ...unsafe, targets: ['" onclick="alert(1)'] }],
        disabled: true,
      }),
    );
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector("[onclick]")).toBeNull();
    expect(node.querySelector('[style*="color:red"]')).toBeNull();
    expect(node.querySelector("button")).toBeDisabled();
  });
});

it("keeps literal TeX contexts from exposing annotation commands", () => {
  const source = String.raw`\verb|c^2|`;
  const node = parse(renderKatex(source, true, { links: [link(source, "c^2")] }));
  expect(node.querySelector(".katex-html")).not.toHaveTextContent("htmlData");
  expect(node.querySelector(".link-label .katex")).not.toBeNull();
  expect(node.querySelectorAll("button")).toHaveLength(1);
});

it.each(["markdown", "katex"])(
  "places each destination beside its own expression in %s",
  (type) => {
    const formula = "a^2 + b^2 = c^2";
    const source = type === "markdown" ? `$${formula}$` : formula;
    const links = [
      { ...link(source, "a^2", "first"), targets: ["first-target"] },
      { ...link(source, "b^2", "second"), targets: ["second-target"] },
    ];
    const node = parse(
      type === "markdown"
        ? renderMarkdown(source, { links })
        : renderKatex(source, true, { links }),
    );
    const visual = node.querySelector(".katex-html")!;
    const first = visual.querySelector('[data-link-ids="first"].link-label')!;
    const second = visual.querySelector('[data-link-ids="second"].link-label')!;
    const firstNumber = visual.querySelector('button[data-render-target="first-target"]')!;
    const secondNumber = visual.querySelector('button[data-render-target="second-target"]')!;
    expect(
      first.compareDocumentPosition(firstNumber) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      firstNumber.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      second.compareDocumentPosition(secondNumber) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(firstNumber.closest('[aria-hidden="true"]')).toBeNull();
    expect(secondNumber.closest('[aria-hidden="true"]')).toBeNull();
    expect(
      [...node.querySelectorAll(".katex-mathml mn")].map((element) => element.textContent),
    ).toEqual(["2", "2", "2"]);
    expect(node.querySelector("annotation")).toHaveTextContent(formula);
    expect(node.querySelectorAll("button")).toHaveLength(2);
  },
);

it("keeps fraction destination numbers attached to the correct source labels", () => {
  const source = String.raw`\frac{a^2}{b^2}`;
  const links = [
    { ...link(source, "a^2", "numerator"), targets: ["top"] },
    { ...link(source, "b^2", "denominator"), targets: ["bottom", "other"] },
  ];
  const node = parse(renderKatex(source, true, { links }));
  expect(
    node.querySelector('.katex-html .destinations[data-link-ids="numerator"] button'),
  ).toHaveAttribute("data-render-target", "top");
  const denominator = node.querySelectorAll(
    '.katex-html .destinations[data-link-ids="denominator"] button',
  );
  expect([...denominator].map((button) => button.getAttribute("data-render-target"))).toEqual([
    "bottom",
    "other",
  ]);
  expect([...denominator].map((button) => button.textContent)).toEqual(["1", "2"]);
  expect(node.querySelectorAll("button")).toHaveLength(3);
});

it("does not let a navigation number replace an original script", () => {
  const source = "c^2_3";
  const node = parse(renderKatex(source, true, { links: [link(source, "c^2")] }));
  expect(node.querySelector(".katex-error")).toBeNull();
  expect(node.querySelector(".link-label .katex")).not.toBeNull();
  expect(node.querySelectorAll("button")).toHaveLength(1);
});
