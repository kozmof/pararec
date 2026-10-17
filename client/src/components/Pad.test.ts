import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import Pad from "./Pad.svelte";
import { TreeStore } from "../lib/tree/tree-store.svelte.js";
const fixture = JSON.parse(readFileSync("fixtures/three-levels.json", "utf8"));
function response(value = fixture) {
  return new Response(JSON.stringify(value), { headers: { ETag: '"v1"' } });
}
function content(id: string) {
  return document.querySelector(`[data-content-id="${id}"]`) as HTMLElement;
}
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function opened() {
  render(Pad);
  await screen.findByTestId("pad-level");
  await tick();
}
async function key(key: string, isComposing = false) {
  await fireEvent.keyDown(window, { key, ctrlKey: true, isComposing });
  await tick();
}

describe("pad navigation", () => {
  it("shows one level of nested children and Go deeper controls", async () => {
    await opened();
    expect(content("root-right")).toHaveTextContent("Root note");
    expect(content("child-right")).toHaveTextContent("Child note");
    expect(content("grandchild-right")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go deeper into Child note" })).toHaveAttribute(
      "title",
      "Go deeper",
    );
    await waitFor(() =>
      expect(content("root-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
    expect(screen.getAllByTestId("editor-sink")).toHaveLength(1);
    expect(screen.getByTestId("pad-level")).toHaveAttribute("data-etag", '"v1"');
  });
  it("enters visible nested Containers and restores focus with Go back", async () => {
    await opened();
    content("child-right").focus();
    await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Child note" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root/child"));
    await waitFor(() =>
      expect(
        content("grandchild-right").querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
  });
  it("backs through each visited layer in order", async () => {
    await opened();
    await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Root note" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root"));
    await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Child note" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root/child"));
    await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root"));
    await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(window.location.hash).toBe("#/"));
  });
  it.each([
    [1, 2, 4],
    [1, 3, 4],
    [0, 2, 4],
  ])(
    "returns through mixed layer jumps %i, %i, %i and can revisit a deeper view",
    async (...depths) => {
      const deep = JSON.parse(readFileSync("fixtures/seven-levels.json", "utf8"));
      vi.mocked(fetch).mockImplementation(() => Promise.resolve(response(deep)));
      await opened();
      const hashAt = (depth: number) =>
        depth < 0
          ? "#/"
          : "#/c/" + Array.from({ length: depth + 1 }, (_, i) => `layer-${i}`).join("/");
      const visit = async (depth: number) => {
        content(`layer-${depth}-right`).focus();
        await waitFor(() =>
          expect(
            content(`layer-${depth}-right`).querySelector('[data-testid="editor-sink"]'),
          ).toHaveFocus(),
        );
        await fireEvent.click(
          screen.getByRole("button", { name: `Go deeper into Layer ${depth + 1} note` }),
        );
        await waitFor(() => expect(window.location.hash).toBe(hashAt(depth)));
      };
      for (const depth of depths) await visit(depth);
      const previous = depths[depths.length - 2];
      await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
      await waitFor(() => expect(window.location.hash).toBe(hashAt(previous)));
      await waitFor(() =>
        expect(
          content(`layer-${depths.at(-1)}-right`).querySelector('[data-testid="editor-sink"]'),
        ).toHaveFocus(),
      );
      await visit(depths.at(-1)!);
      for (const depth of [...depths.slice(0, -1).reverse(), -1]) {
        await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
        await waitFor(() => expect(window.location.hash).toBe(hashAt(depth)));
        await waitFor(() =>
          expect(screen.getByRole("status", { name: "Current layer" })).toHaveTextContent(
            `${depth + 2}:7`,
          ),
        );
      }
      expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
    },
  );
  it("falls back to the parent when a deep layer is opened directly", async () => {
    window.history.replaceState(null, "", "#/c/root/child");
    await opened();
    await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root"));
  });
  it("ignores the removed layer navigation shortcuts", async () => {
    await opened();
    content("root-right").focus();
    await key(".");
    expect(window.location.hash).toBe("#/");
    await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Root note" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root"));
    await key(",");
    expect(window.location.hash).toBe("#/c/root");
  });

  it("opens the deepest valid URL prefix and handles browser hash navigation", async () => {
    window.history.replaceState(null, "", "#/c/root/child/missing/grandchild");
    await opened();
    expect(window.location.hash).toBe("#/c/root/child");
    expect(content("grandchild-right")).toBeInTheDocument();
    window.history.replaceState(null, "", "#/c/root");
    await fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() =>
      expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
  });
  it("creates a missing document's first row with Enter and focuses its right note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await opened();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add row" })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    expect(document.querySelectorAll("[data-container-id]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-content-id]")).toHaveLength(2);
  });
  it("adds a row to an empty child level", async () => {
    window.history.replaceState(null, "", "#/c/root/child/grandchild");
    await opened();
    await fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    expect(window.location.hash).toBe("#/c/root/child/grandchild");
    expect(screen.getByTestId("pad-level").querySelectorAll("[data-container-id]")).toHaveLength(1);
    expect(screen.getByTestId("parent-level").querySelectorAll("[data-content-id]")).toHaveLength(
      1,
    );
  });
  it("shows a failed load and retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response()),
    );
    render(Pad);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the local server");
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("pad-level");
    expect(content("root-right")).toBeInTheDocument();
  });
  it("canonicalizes an unknown route to the root level", async () => {
    await opened();
    window.history.replaceState(null, "", "#/unknown");
    await fireEvent(window, new HashChangeEvent("hashchange"));
    expect(window.location.hash).toBe("#/");
  });
  it("aborts pending requests when unmounted", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      }),
    );
    const { unmount } = render(Pad);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

it("restores the Add row control after removing the final row", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  const apply = vi.spyOn(TreeStore.prototype, "apply");
  await opened();
  await fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  const store = apply.mock.contexts[0] as TreeStore;
  store.apply({ type: "removeContainer", id: store.schema.root[0].id });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add row" })).toHaveFocus());
});

it.each([
  ["unreadable", () => new Response(null, { status: 500 }), "permissions"],
  ["invalid", () => new Response("{broken", { headers: { ETag: '"bad"' } }), "file is invalid"],
])(
  "keeps the editor closed after an %s load and recovers on Retry",
  async (_name, failed, message) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce((failed as () => Response)())
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    render(Pad);
    expect(await screen.findByRole("alert")).toHaveTextContent(message as string);
    expect(screen.queryByTestId("editor-sink")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it("shows the filename title and applies configured width rates", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ...fixture,
        title: undefined,
        config: {
          renderType: "none",
          renderTypes: ["none", "markdown", "katex"],
          showTitles: true,
          maxWidth: 1100,
          outerWidthRate: { left: 2, right: 3 },
          innerWidthRate: { left: 1, right: 4 },
        },
      }),
      { headers: { ETag: '"v1"', "X-Document-Title": JSON.stringify("my.notes") } },
    ),
  );
  await opened();
  expect(screen.getByRole("textbox", { name: "Document title" })).toHaveValue("my.notes");
  const main = document.querySelector("main")!;
  expect(main.style.getPropertyValue("--outer-left")).toBe("2fr");
  expect(main.style.getPropertyValue("--inner-right")).toBe("4fr");
});

it.each([true, false])("respects title visibility %s", async (showTitle) => {
  vi.mocked(fetch).mockResolvedValue(
    response({
      ...fixture,
      title: "Custom notes",
      config: { ...fixture.config, showTitles: showTitle },
    }),
  );
  await opened();
  expect(screen.queryByRole("textbox", { name: "Document title" }) !== null).toBe(showTitle);
});

it("shows the current layer and whole-document depth while navigating", async () => {
  await opened();
  const status = screen.getByRole("status", { name: "Current layer" });
  expect(status).toHaveTextContent("1:3");
  await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Root note" }));
  await waitFor(() => expect(status).toHaveTextContent("2:3"));
  await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Child note" }));
  await waitFor(() => expect(status).toHaveTextContent("3:3"));
  await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  await waitFor(() => expect(status).toHaveTextContent("2:3"));
});

it("shows layer status on an empty document with the title hidden", async () => {
  vi.mocked(fetch).mockResolvedValue(
    response({ ...fixture, root: [], config: { ...fixture.config, showTitles: false } }),
  );
  await opened();
  expect(screen.queryByRole("textbox", { name: "Document title" })).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Current layer" })).toHaveTextContent("1:1");
});

it("applies the configured maximum width to the whole records layout", async () => {
  vi.mocked(fetch).mockResolvedValue(
    response({ ...fixture, config: { ...fixture.config, maxWidth: 900 } }),
  );
  await opened();
  expect(document.querySelector("main")).toHaveStyle({ maxWidth: "900px" });
});

for (const destination of ["child-right", "child-left"]) {
  it(`follows a link to visible ${destination} without changing layers`, async () => {
    const document = structuredClone(fixture);
    document.links = [
      { id: "link", sourceId: "root-right", start: 0, end: 4, targets: [destination] },
    ];
    vi.mocked(fetch).mockResolvedValue(response(document));
    await opened();
    const hash = window.location.hash;
    await fireEvent.click(screen.getByRole("button", { name: /Linked cell 1:/ }));
    await waitFor(() =>
      expect(content(destination).querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
    expect(window.location.hash).toBe(hash);
    expect(screen.getByRole("status", { name: "Current layer" })).toHaveTextContent("1:3");
  });
}

it("follows a link to the visible parent without leaving the current layer", async () => {
  const document = structuredClone(fixture);
  document.links = [
    { id: "link", sourceId: "child-right", start: 0, end: 5, targets: ["root-right"] },
  ];
  vi.mocked(fetch).mockResolvedValue(response(document));
  window.history.replaceState(null, "", "/#/c/root");
  await opened();
  await fireEvent.click(screen.getByRole("button", { name: /Linked cell 1:/ }));
  await waitFor(() =>
    expect(content("root-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  expect(window.location.hash).toBe("#/c/root");
  expect(screen.getByRole("status", { name: "Current layer" })).toHaveTextContent("2:3");
});

it("changes layers when a linked destination is not currently shown", async () => {
  const document = structuredClone(fixture);
  document.links = [
    { id: "link", sourceId: "root-right", start: 0, end: 4, targets: ["grandchild-right"] },
  ];
  vi.mocked(fetch).mockResolvedValue(response(document));
  await opened();
  expect(content("grandchild-right")).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: /Linked cell 1:/ }));
  await waitFor(() =>
    expect(content("grandchild-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  expect(window.location.hash).toBe("#/c/root/child");
  expect(screen.getByRole("status", { name: "Current layer" })).toHaveTextContent("3:3");
});

it("navigates with arrows while linking without selecting their cells", async () => {
  await opened();
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await fireEvent.keyDown(screen.getByTestId("editor-sink"), { key: "a", ctrlKey: true });
  await fireEvent.contextMenu(content("root-right"));
  await fireEvent.click(screen.getByRole("menuitem", { name: "Start linking" }));
  const toolbar = screen.getByRole("region", { name: "Link selected text" });
  await fireEvent.mouseDown(content("child-left"), { button: 0 });
  expect(toolbar).toHaveTextContent("Select cells to link (1)");
  const deeper = screen.getByRole("button", { name: "Go deeper into Child note" });
  expect(await fireEvent.keyDown(deeper, { key: "Enter" })).toBe(true);
  await fireEvent.mouseDown(deeper.querySelector("svg")!, { button: 0 });
  expect(toolbar).toHaveTextContent("Select cells to link (1)");
  await fireEvent.click(deeper);
  await waitFor(() => expect(window.location.hash).toBe("#/c/root/child"));
  expect(content("child-right")).not.toHaveClass("chosen");
  expect(screen.queryByTestId("editor-sink")).not.toBeInTheDocument();
  await fireEvent.mouseDown(content("grandchild-right"), { button: 0 });
  expect(toolbar).toHaveTextContent("Select cells to link (2)");
  const back = screen.getByRole("button", { name: "Go back" });
  await fireEvent.mouseDown(back.querySelector("svg")!, { button: 0 });
  expect(toolbar).toHaveTextContent("Select cells to link (2)");
  await fireEvent.click(back);
  await waitFor(() => expect(window.location.hash).toBe("#/"));
  expect(content("child-left")).toHaveClass("chosen");
  expect(content("grandchild-right")).toBeNull();
  expect(toolbar).toHaveTextContent("Select cells to link (2)");
  await fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(content("root-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("s");
  await waitFor(() =>
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === "PUT")).toBe(true),
  );
  const save = [...vi.mocked(fetch).mock.calls]
    .reverse()
    .find(([, options]) => options?.method === "PUT")!;
  expect(JSON.parse(save[1]!.body as string).links[0].targets).toEqual([
    "child-left",
    "grandchild-right",
  ]);
});

it("renders inherited Markdown and opens the source for editing", async () => {
  const value = structuredClone(fixture);
  value.config.renderType = "markdown";
  value.root[0].left[0].text = "**bold** and $x^2$";
  vi.mocked(fetch).mockResolvedValue(response(value));
  await opened();
  const cell = content(value.root[0].left[0].id);
  expect(cell.querySelector("strong")).toHaveTextContent("bold");
  expect(cell.querySelector(".katex")).not.toBeNull();
  await fireEvent.mouseDown(cell.querySelector("strong")!);
  await waitFor(() => expect(cell.querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  expect(cell.querySelector("[data-render-type]")).toBeNull();
});

it("switches a cell renderer from its context menu and supports undo", async () => {
  const value = structuredClone(fixture);
  value.root[0].left[0].text = "**bold**";
  vi.mocked(fetch).mockResolvedValue(response(value));
  await opened();
  const cell = content(value.root[0].left[0].id);
  await fireEvent.contextMenu(cell, { clientX: 100, clientY: 100 });
  expect(screen.getByRole("menuitemradio", { name: "Default (none)" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await fireEvent.click(screen.getByRole("menuitemradio", { name: "Markdown" }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(cell.querySelector("strong")).toHaveTextContent("bold");
  await key("z");
  expect(cell.querySelector("strong")).toBeNull();
  await fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
  await tick();
  expect(cell.querySelector("strong")).toHaveTextContent("bold");
});

it("offers inheritance, explicit plain text, and registered renderers", async () => {
  const { registerRenderer, escapeHTML } = await import("../lib/render/renderers.js");
  const dispose = registerRenderer("notice", (text) => `<aside>${escapeHTML(text)}</aside>`);
  try {
    const value = structuredClone(fixture);
    value.config.renderType = "markdown";
    value.config.renderTypes = ["none", "markdown", "katex", "notice"];
    value.root[0].left[0].text = "**bold**";
    vi.mocked(fetch).mockResolvedValue(response(value));
    await opened();
    const cell = content(value.root[0].left[0].id);
    await fireEvent.contextMenu(cell);
    await fireEvent.click(screen.getByRole("menuitemradio", { name: "None" }));
    expect(cell.querySelector("strong")).toBeNull();
    await fireEvent.contextMenu(cell);
    expect(screen.getByRole("menuitemradio", { name: "None" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await fireEvent.click(screen.getByRole("menuitemradio", { name: "Default (markdown)" }));
    expect(cell.querySelector("strong")).toHaveTextContent("bold");
    await fireEvent.contextMenu(cell);
    await fireEvent.click(screen.getByRole("menuitemradio", { name: "notice" }));
    expect(cell.querySelector("aside")).toHaveTextContent("**bold**");
  } finally {
    dispose();
  }
});

it("dismisses the render menu with Escape or an outside click", async () => {
  await opened();
  const cell = content(fixture.root[0].left[0].id);
  await fireEvent.contextMenu(cell);
  await fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  await fireEvent.contextMenu(cell);
  await fireEvent.click(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("limits the context menu to config.renderTypes", async () => {
  const value = structuredClone(fixture);
  value.config.renderTypes = ["none", "custom"];
  vi.mocked(fetch).mockResolvedValue(response(value));
  await opened();
  const cell = content(value.root[0].left[0].id);
  await fireEvent.contextMenu(cell);
  expect(screen.queryByRole("menuitemradio", { name: "Markdown" })).toBeNull();
  expect(screen.queryByRole("menuitemradio", { name: "KaTeX" })).toBeNull();
  await fireEvent.click(screen.getByRole("menuitemradio", { name: "custom" }));
  expect(cell).toHaveTextContent(value.root[0].left[0].text);
  await fireEvent.contextMenu(cell);
  expect(screen.getByRole("menuitemradio", { name: "custom" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

it("keeps Markdown source mounted while its context menu has focus", async () => {
  const value = structuredClone(fixture);
  value.config.renderType = "markdown";
  value.root[0].left[0].text = "**bold** and $x^2$";
  vi.mocked(fetch).mockResolvedValue(response(value));
  await opened();
  const cell = content(value.root[0].left[0].id);
  await fireEvent.mouseDown(cell.querySelector("strong")!);
  await waitFor(() => expect(cell.querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  const sink = cell.querySelector('[data-testid="editor-sink"]');
  await fireEvent.contextMenu(cell);
  const menu = screen.getByRole("menu", { name: "Cell options" });
  await waitFor(() => expect(menu.querySelector("button")).toHaveFocus());
  expect(cell.querySelector('[data-testid="editor-sink"]')).toBe(sink);
  expect(cell.querySelector("[data-render-type]")).toBeNull();
  expect(cell).toHaveTextContent("**bold** and $x^2$");
  await fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(cell.querySelector("[data-render-type]")).toBeNull();
  await fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(sink).toHaveFocus());
  expect(cell.querySelector("[data-render-type]")).toBeNull();
  await fireEvent.contextMenu(cell);
  await fireEvent.click(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(cell.querySelector("strong")).toHaveTextContent("bold");
});

it("returns to the rendered preview when focus leaves the context menu", async () => {
  const value = structuredClone(fixture);
  value.config.renderType = "markdown";
  value.root[0].left[0].text = "**bold**";
  vi.mocked(fetch).mockResolvedValue(response(value));
  await opened();
  const cell = content(value.root[0].left[0].id);
  await fireEvent.mouseDown(cell.querySelector("strong")!);
  await waitFor(() => expect(cell.querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await fireEvent.contextMenu(cell);
  await waitFor(() => expect(screen.getByRole("menu").querySelector("button")).toHaveFocus());
  screen.getByRole("textbox", { name: "Document title" }).focus();
  await tick();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(cell.querySelector("strong")).toHaveTextContent("bold");
});

it("shows math link labels in rendered cells and follows their destinations", async () => {
  const value = structuredClone(fixture);
  const source = value.root[0].left[0];
  source.renderType = "markdown";
  source.text = "Energy: $E = mc^2$";
  const target = value.root[0].right.id;
  const start = new TextEncoder().encode(source.text.slice(0, source.text.indexOf("c^2"))).length;
  value.links = [
    { id: "math-label", sourceId: source.id, start, end: start + 3, targets: [target] },
  ];
  vi.mocked(fetch).mockResolvedValue(response(value));
  await opened();
  const cell = content(source.id);
  expect(cell.querySelector(".katex-html .link-label")).toHaveAttribute(
    "data-link-ids",
    "math-label",
  );
  const destination = cell.querySelector<HTMLButtonElement>("button[data-render-target]")!;
  expect(destination).toHaveAccessibleName("Linked cell 1: Go to linked cell");
  destination.focus();
  await tick();
  expect(cell.querySelector("[data-render-type]")).not.toBeNull();
  await fireEvent.click(destination);
  await waitFor(() =>
    expect(content(target).querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  expect(cell.querySelector("[data-render-type]")).not.toBeNull();
  await fireEvent.contextMenu(cell.querySelector(".link-label")!);
  await fireEvent.click(screen.getByRole("menuitem", { name: "Remove label" }));
  await waitFor(() => expect(cell.querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await fireEvent.contextMenu(cell);
  await fireEvent.click(screen.getByRole("menuitemradio", { name: "Markdown" }));
  expect(cell.querySelector("[data-render-type]")).not.toBeNull();
  expect(cell.querySelector("[data-link-ids]")).toBeNull();
});

it.each(["markdown", "katex"])(
  "follows b squared's destination inside a rendered %s quadratic formula",
  async (type) => {
    const value = structuredClone(fixture);
    const source = value.root[0].left[0];
    const formula = String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`;
    source.renderType = type;
    source.text = type === "markdown" ? `$$\n${formula}\n$$` : formula;
    const target = value.root[0].right.id;
    const start = new TextEncoder().encode(source.text.slice(0, source.text.indexOf("b^2"))).length;
    value.links = [
      { id: "quadratic", sourceId: source.id, start, end: start + 3, targets: [target] },
    ];
    vi.mocked(fetch).mockResolvedValue(response(value));
    await opened();
    const cell = content(source.id);
    const destination = cell.querySelector<HTMLButtonElement>(".sqrt button[data-render-target]")!;
    expect(destination).not.toBeNull();
    expect(cell.querySelector(".katex-error")).toBeNull();
    await fireEvent.mouseDown(destination, { button: 0 });
    expect(cell.querySelector("[data-render-type]")).not.toBeNull();
    await fireEvent.click(destination);
    await waitFor(() =>
      expect(content(target).querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
    expect(cell.querySelector("[data-render-type]")).not.toBeNull();
  },
);
