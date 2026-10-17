import { describe, expect, it } from "vitest";
import { getRenderer, registerRenderer, renderKatex, renderMarkdown } from "./renderers.js";
import { parseSchema } from "../../schema.js";

describe("cell rendering", () => {
  it("renders Markdown structure and math while keeping code literal", () => {
    const html = renderMarkdown("# Title\n\n**bold** and $x^2$\n\n`$literal$`\n\n$$\\frac{1}{2}$$");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("<code>$literal$</code>");
  });
  it("escapes HTML and rejects executable URLs", () => {
    const node = document.createElement("div");
    node.innerHTML = renderMarkdown(
      "<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![bad](javascript:bad)",
    );
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector("a")?.getAttribute("href")).toBe("");
    expect(node.querySelector("img")?.getAttribute("src")).toBe("");
  });
  it("handles invalid formulas without throwing", () => {
    expect(renderKatex("\\invalidcommand{")).toContain("katex-error");
  });
  it("preserves extensible type names and supports registration and fallback", () => {
    const schema = parseSchema({
      version: 1,
      config: { renderType: "markdown", renderTypes: ["none", "markdown", "katex", "custom"] },
      root: [
        {
          id: "row",
          left: [{ id: "left", text: "a", renderType: "custom" }],
          right: { id: "right", text: "b", renderType: "none", children: [] },
        },
      ],
    });
    expect(schema.config.renderType).toBe("markdown");
    expect(schema.root[0].left[0].renderType).toBe("custom");
    const dispose = registerRenderer("custom", (source) => `<b>${source.length}</b>`);
    expect(getRenderer("custom")?.("abc")).toBe("<b>3</b>");
    dispose();
    expect(getRenderer("custom")).toBeUndefined();
    expect(() => parseSchema({ version: 1, root: [], config: { renderType: 1 } })).toThrow();
  });
});

it("changes render types with undo and restores inheritance", async () => {
  const { TreeStore } = await import("../tree/tree-store.svelte.js");
  const store = new TreeStore({
    version: 1,
    root: [
      {
        id: "row",
        left: [{ id: "left", text: "source" }],
        right: { id: "right", text: "", children: [] },
      },
    ],
  });
  const undoDefault = store.apply({ type: "setDefaultRenderType", renderType: "markdown" });
  const undoCell = store.apply({ type: "setRenderType", id: "right", renderType: "katex" });
  expect(store.schema.root[0].right.renderType).toBe("katex");
  store.apply(undoCell);
  expect(store.schema.root[0].right.renderType).toBeUndefined();
  store.apply(undoDefault);
  expect(store.schema.config.renderType ?? "none").toBe("none");
});

it("validates renderer changes and insertions against the configured list", async () => {
  const { TreeStore } = await import("../tree/tree-store.svelte.js");
  const store = new TreeStore({
    version: 1,
    root: [
      {
        id: "row",
        left: [{ id: "left", text: "" }],
        right: { id: "right", text: "", children: [] },
      },
    ],
  });
  const before = store.schema;
  expect(() => store.apply({ type: "setRenderType", id: "left", renderType: "custom" })).toThrow();
  expect(() => store.apply({ type: "setDefaultRenderType", renderType: "custom" })).toThrow();
  expect(() =>
    store.apply({
      type: "insertContent",
      containerId: "row",
      index: 1,
      content: { id: "new", text: "", renderType: "custom" },
    }),
  ).toThrow();
  expect(() =>
    store.apply({
      type: "insertContainer",
      parentId: null,
      index: 1,
      container: {
        id: "new-row",
        left: [{ id: "new-left", text: "", renderType: "custom" }],
        right: { id: "new-right", text: "", children: [] },
      },
    }),
  ).toThrow();
  expect(store.schema).toBe(before);
  const undoTypes = store.apply({
    type: "setRenderTypes",
    renderTypes: [...store.schema.config.renderTypes, "custom"],
  });
  const undoDefault = store.apply({ type: "setDefaultRenderType", renderType: "custom" });
  expect(() => store.apply(undoTypes)).toThrow();
  store.apply(undoDefault);
  const undoInsert = store.apply({
    type: "insertContent",
    containerId: "row",
    index: 1,
    content: { id: "new", text: "", renderType: "custom" },
  });
  expect(store.schema.root[0].left[1].renderType).toBe("custom");
  expect(() => store.apply(undoTypes)).toThrow();
  const redoInsert = store.apply(undoInsert);
  store.apply(redoInsert);
  expect(store.schema.root[0].left[1].renderType).toBe("custom");
  store.apply(undoInsert);
  store.apply(undoTypes);
  expect(store.schema).toEqual(before);
});

it("renders the reported list and requires a space after heading markers", () => {
  const node = document.createElement("div");
  node.innerHTML = renderMarkdown("#test\n\n- abc\n- def");
  expect(node.querySelector("p")).toHaveTextContent("#test");
  expect([...node.querySelectorAll("ul > li")].map((item) => item.textContent?.trim())).toEqual([
    "abc",
    "def",
  ]);
  expect(node.querySelector("h1")).toBeNull();
  node.innerHTML = renderMarkdown("# test\n\n- abc\n- def");
  expect(node.querySelector("h1")).toHaveTextContent("test");
});

it("disposes overlapping registrations in any order without reviving removed renderers", () => {
  const original = getRenderer("markdown");
  const first = () => "first";
  const second = () => "second";
  const disposeFirst = registerRenderer("markdown", first);
  const disposeSecond = registerRenderer("markdown", second);
  disposeFirst();
  expect(getRenderer("markdown")).toBe(second);
  disposeSecond();
  expect(getRenderer("markdown")).toBe(original);
  const disposeNew = registerRenderer("markdown", first);
  disposeFirst();
  disposeSecond();
  expect(getRenderer("markdown")).toBe(first);
  disposeNew();
  expect(getRenderer("markdown")).toBe(original);
});

it("tracks separate registrations of the same renderer function", () => {
  const renderer = () => "same";
  const first = registerRenderer("overlap", renderer);
  const second = registerRenderer("overlap", renderer);
  second();
  expect(getRenderer("overlap")).toBe(renderer);
  first();
  expect(getRenderer("overlap")).toBeUndefined();
});
