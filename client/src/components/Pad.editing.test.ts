import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import Pad from "./Pad.svelte";
import { IndexedRecovery } from "../lib/api/recovery.js";
import type { Schema } from "../schema.js";
let disk: Schema;
let etag: string;
let puts: { schema: Schema; headers: Record<string, string> }[];
let conflict: boolean;
const original = JSON.parse(readFileSync("fixtures/flat.json", "utf8"));
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
beforeEach(() => {
  disk = clone(original);
  etag = '"v1"';
  puts = [];
  conflict = false;
  window.history.replaceState(null, "", "/");
  vi.spyOn(IndexedRecovery.prototype, "read").mockResolvedValue(null);
  vi.spyOn(IndexedRecovery.prototype, "write").mockResolvedValue();
  vi.spyOn(IndexedRecovery.prototype, "clear").mockResolvedValue();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      if (options?.method !== "PUT")
        return new Response(JSON.stringify(disk), { headers: { ETag: etag } });
      puts.push({ schema: JSON.parse(options.body), headers: options.headers });
      if (conflict) return new Response(null, { status: 412 });
      disk = JSON.parse(options.body);
      etag = `"v${puts.length + 1}"`;
      return new Response(null, { status: 204, headers: { ETag: etag } });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function opened() {
  render(Pad);
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
}
async function key(key: string, extra = {}) {
  await fireEvent.keyDown(screen.getByTestId("editor-sink"), { key, ...extra });
  await tick();
  await tick();
}
async function save() {
  await key("s", { ctrlKey: true });
  await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
}
const content = (id: string) => document.querySelector(`[data-content-id="${id}"]`) as HTMLElement;

describe("integrated content editing", () => {
  it("commits Japanese composition once, excludes preedit from saving, and survives remount", async () => {
    const view = render(Pad);
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    const sink = screen.getByTestId("editor-sink");
    await fireEvent.compositionStart(sink);
    await fireEvent.compositionUpdate(sink, { data: "にほん" });
    await fireEvent.keyDown(sink, { key: "s", ctrlKey: true, isComposing: true });
    expect(puts).toHaveLength(0);
    await fireEvent.compositionEnd(sink, { data: "日本" });
    await save();
    expect(disk.root[0].right.text).toBe("日本First note");
    expect(puts).toHaveLength(1);
    view.unmount();
    await opened();
    expect(content(disk.root[0].right.id)).toHaveTextContent("日本First note");
  });
  it("moves between columns and adjacent right notes at boundaries", async () => {
    await opened();
    await key("ArrowLeft", { altKey: true });
    await waitFor(() =>
      expect(
        content(disk.root[0].left[0].id).querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await key("X");
    await key("ArrowRight", { altKey: true });
    await waitFor(() =>
      expect(
        content(disk.root[0].right.id).querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await key("End", { ctrlKey: true });
    await key("ArrowRight");
    await waitFor(() =>
      expect(
        content(disk.root[1].left[0].id).querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await key("!");
    await save();
    expect(disk.root[0].left[0].text.startsWith("X")).toBe(true);
    expect(disk.root[1].left[0].text.startsWith("!")).toBe(true);
  });
  it("Reload replaces cached text and the ETag before the next save", async () => {
    await opened();
    await key("X");
    conflict = true;
    await key("s", { ctrlKey: true });
    await screen.findByRole("dialog", { name: "File changed on disk" });
    disk.root[0].right.text = "External";
    etag = '"external"';
    conflict = false;
    await fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    expect(content(disk.root[0].right.id)).toHaveTextContent("External");
    await key("!");
    await save();
    expect(puts.at(-1)!.headers["If-Match"]).toBe('"external"');
    expect(disk.root[0].right.text).toBe("!External");
  });
  it("Overwrite preserves local text and fetches the current ETag", async () => {
    await opened();
    await key("X");
    conflict = true;
    await key("s", { ctrlKey: true });
    await screen.findByRole("dialog", { name: "File changed on disk" });
    disk.root[0].right.text = "External";
    etag = '"external"';
    conflict = false;
    await fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(disk.root[0].right.text).toBe("XFirst note");
    expect(puts.at(-1)!.headers["If-Match"]).toBe('"external"');
  });
  it("restores local notes only after confirmation when the disk document differs", async () => {
    const base = clone(disk),
      schema = clone(disk);
    schema.root[0].right.text = "Recovered";
    vi.mocked(IndexedRecovery.prototype.read).mockResolvedValue({ schema, base, savedAt: 1 });
    disk.root[0].right.text = "External";
    render(Pad);
    await screen.findByRole("dialog", { name: "Recover unsaved notes" });
    expect(screen.queryByTestId("editor-sink")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /^Restore$/ }));
    expect(puts).toHaveLength(0);
    await fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    await save();
    expect(disk.root[0].right.text).toBe("Recovered");
  });
  it("discards local recovery and retains the disk document", async () => {
    const schema = clone(disk);
    schema.root[0].right.text = "Recovered";
    vi.mocked(IndexedRecovery.prototype.read).mockResolvedValue({ schema, base: disk, savedAt: 1 });
    render(Pad);
    await screen.findByRole("dialog", { name: "Recover unsaved notes" });
    await fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    expect(content(disk.root[0].right.id)).toHaveTextContent("First note");
    expect(puts).toHaveLength(0);
    expect(IndexedRecovery.prototype.clear).toHaveBeenCalled();
  });
  it("warns before leaving with unsaved edits and flushes when the page becomes hidden", async () => {
    await opened();
    await key("!");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(disk.root[0].right.text).toBe("!First note");
  });
});

it("retains goalX across a shorter Content between longer Contents", async () => {
  disk.root[0].right.text = "abcdef";
  disk.root[1].right.text = "q";
  disk.root.push({
    id: "third",
    left: [{ id: "third-l", text: "" }],
    right: { id: "third-r", text: "abcdef", children: [] },
  });
  await opened();
  for (let column = 0; column < 4; column++) await key("ArrowRight");
  await key("ArrowDown");
  await waitFor(() =>
    expect(content("flat-2-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("ArrowDown");
  await waitFor(() =>
    expect(content("third-r").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("!");
  await save();
  expect(disk.root[2].right.text).toBe("abcd!ef");
});

it("does not forward composition keys to pad navigation even without isComposing", async () => {
  await opened();
  const sink = screen.getByTestId("editor-sink");
  await fireEvent.compositionStart(sink);
  await fireEvent.compositionUpdate(sink, { data: "日本" });
  await fireEvent.keyDown(sink, { key: ",", ctrlKey: true });
  await fireEvent.keyDown(sink, { key: "s", ctrlKey: true });
  expect(puts).toHaveLength(0);
  expect(sink).toHaveFocus();
  await fireEvent.compositionEnd(sink, { data: "日本" });
  await save();
  expect(disk.root[0].right.text).toBe("日本First note");
});

it("forwards all undo shortcuts to app history instead of native Reed history", async () => {
  await opened();
  await key("X");
  await key("z", { ctrlKey: true });
  await key("z", { ctrlKey: true, shiftKey: true });
  await key("y", { ctrlKey: true });
  await save();
  expect(disk.root[0].right.text).toBe("XFirst note");
});

it("Shift+Enter splits a right note into a sibling and saves both halves together", async () => {
  await opened();
  for (let column = 0; column < 6; column++) await key("ArrowRight");
  await key("Enter", { shiftKey: true });
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("!");
  await save();
  expect(disk.root.map((row) => row.right.text)).toEqual(["First ", "!note", "Second note"]);
  expect(puts).toHaveLength(1);
  expect(disk.root[1].left[0].text).toBe("");
});

it("splits and joins left notes and restores the caret at the join point", async () => {
  await opened();
  await key("ArrowLeft", { altKey: true });
  await waitFor(() =>
    expect(content("flat-1-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await fireEvent.input(screen.getByTestId("editor-sink"), { target: { value: "alpha\nbeta" } });
  await key("Home", { ctrlKey: true });
  await key("ArrowRight");
  await key("ArrowRight");
  await key("Enter", { ctrlKey: true });
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("Backspace");
  await waitFor(() =>
    expect(content("flat-1-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("!");
  await save();
  expect(disk.root[0].left).toEqual([{ id: "flat-1-left", text: "al!\npha\nbeta" }]);
});

it("Ctrl+Enter creates children and enters the level for a new grandchild", async () => {
  await opened();
  await key("Enter", { ctrlKey: true });
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("Enter", { ctrlKey: true });
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/c\/flat-1\//));
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await fireEvent.input(screen.getByTestId("editor-sink"), { target: { value: "日本" } });
  await save();
  const child = disk.root[0].right.children[0];
  expect(child.right.children[0].right.text).toBe("日本");
  expect(window.location.hash).toBe(`#/c/flat-1/${child.id}`);
});

it("deletes an empty row, disposes its notes, and focuses the next right note", async () => {
  disk.root[0].right.text = "";
  await opened();
  await key("Backspace");
  await waitFor(() =>
    expect(content("flat-2-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("!");
  await save();
  expect(disk.root).toHaveLength(1);
  expect(disk.root[0].right.text).toBe("!Second note");
  expect(content("flat-1-right")).toBeNull();
});

it("Alt+Down moves rows and left notes across neighbouring rows while preserving caret", async () => {
  disk.root[0].left.push({ id: "second-left", text: "abcd" });
  await opened();
  await key("ArrowRight");
  await key("ArrowDown", { altKey: true });
  await waitFor(() =>
    expect(content("flat-1-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("!");
  await key("ArrowLeft", { altKey: true });
  await waitFor(() =>
    expect(content("flat-1-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("ArrowUp", { altKey: true });
  await waitFor(() =>
    expect(content("flat-1-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("L");
  await save();
  expect(disk.root.map((row) => row.id)).toEqual(["flat-2", "flat-1"]);
  expect(disk.root[0].left.at(-1)).toEqual({ id: "flat-1-left", text: "L" });
  expect(disk.root[1].right.text).toBe("F!irst note");
});

it("keeps structure shortcuts inside the IME until composition commits", async () => {
  await opened();
  const sink = screen.getByTestId("editor-sink");
  await fireEvent.compositionStart(sink);
  await fireEvent.compositionUpdate(sink, { data: "にほん" });
  await fireEvent.keyDown(sink, { key: "Enter", shiftKey: true });
  await fireEvent.keyDown(sink, { key: "Enter", ctrlKey: true });
  await fireEvent.keyDown(sink, { key: "ArrowDown", altKey: true });
  await fireEvent.compositionEnd(sink, { data: "日本" });
  await save();
  expect(disk.root).toHaveLength(2);
  expect(disk.root[0].right.text).toBe("日本First note");
  expect(disk.root[0].right.children).toEqual([]);
});

it("undoes a typing group and restores its caret on redo", async () => {
  await opened();
  await key("a");
  await key("b");
  await key("c");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("First note");
  expect(content("flat-1-right")).not.toHaveTextContent("abc");
  await key("z", { ctrlKey: true, shiftKey: true });
  await key("!");
  await save();
  expect(disk.root[0].right.text).toBe("abc!First note");
});

it("undoes text, row movement, and text as three separate actions", async () => {
  await opened();
  await key("X");
  await key("ArrowDown", { altKey: true });
  await key("Y");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("XFirst note");
  await key("z", { ctrlKey: true });
  await save();
  expect(disk.root.map((row) => row.id)).toEqual(["flat-1", "flat-2"]);
  expect(disk.root[0].right.text).toBe("XFirst note");
  await key("z", { ctrlKey: true });
  await save();
  expect(disk).toEqual(original);
  await key("y", { ctrlKey: true });
  await key("y", { ctrlKey: true });
  await key("y", { ctrlKey: true });
  await save();
  expect(disk.root.map((row) => row.id)).toEqual(["flat-2", "flat-1"]);
  expect(disk.root[1].right.text).toBe("XYFirst note");
});

it("restores both halves and the caret when undoing a split", async () => {
  await opened();
  for (let i = 0; i < 6; i++) await key("ArrowRight");
  await key("Enter", { shiftKey: true });
  await key("z", { ctrlKey: true });
  await key("!");
  await save();
  expect(disk.root).toHaveLength(2);
  expect(disk.root[0].right.text).toBe("First !note");
  await key("y", { ctrlKey: true });
});

it("undoes a composition independently from adjacent typing", async () => {
  await opened();
  await key("X");
  const sink = screen.getByTestId("editor-sink");
  await fireEvent.compositionStart(sink);
  await fireEvent.compositionUpdate(sink, { data: "にほん" });
  await fireEvent.compositionEnd(sink, { data: "日本" });
  await key("Y");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("X日本First note");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("XFirst note");
  await key("z", { ctrlKey: true });
  await save();
  expect(disk).toEqual(original);
});

it("clears history when a conflict reload replaces the document", async () => {
  await opened();
  await key("X");
  conflict = true;
  await key("s", { ctrlKey: true });
  await screen.findByRole("dialog", { name: "File changed on disk" });
  disk.root[0].right.text = "External";
  conflict = false;
  await fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("External");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent(disk.root[0].right.text);
});

it("undoes empty-level creation and redoes it from Add row", async () => {
  disk.root = [];
  render(Pad);
  const add = await screen.findByRole("button", { name: "Add row" });
  await fireEvent.click(add);
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("z", { ctrlKey: true });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add row" })).toHaveFocus());
  await fireEvent.keyDown(screen.getByRole("button", { name: "Add row" }), {
    key: "z",
    ctrlKey: true,
    shiftKey: true,
  });
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("!");
  await save();
  expect(disk.root[0].right.text).toBe("!");
});

it("returns to the recorded level when undoing after navigating away", async () => {
  await opened();
  await key("Enter", { ctrlKey: true });
  await key("Enter", { ctrlKey: true });
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/c\/flat-1\//));
  const recorded = window.location.hash;
  await key("X");
  await key(",", { ctrlKey: true });
  await waitFor(() => expect(window.location.hash).toBe("#/c/flat-1"));
  await key("z", { ctrlKey: true });
  await waitFor(() => expect(window.location.hash).toBe(recorded));
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("!");
  await save();
  expect(disk.root[0].right.children[0].right.children[0].right.text).toBe("!");
});

it("saves an undone snapshot and loads it on remount", async () => {
  const view = render(Pad);
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  await key("X");
  await save();
  await key("z", { ctrlKey: true });
  await save();
  expect(disk).toEqual(original);
  view.unmount();
  await opened();
  expect(content("flat-1-right")).toHaveTextContent("First note");
  await key("z", { ctrlKey: true });
});

it("starts a new typing group after undo and discards the old redo", async () => {
  await opened();
  await key("a");
  await key("b");
  await key("z", { ctrlKey: true });
  await key("X");
  await key("Y");
  await key("y", { ctrlKey: true });
  await key("z", { ctrlKey: true });
  await save();
  expect(disk).toEqual(original);
});

it("undoes a left-note join as one action with both original ids", async () => {
  disk.root[0].left = [
    { id: "flat-1-left", text: "first" },
    { id: "other-left", text: "second" },
  ];
  await opened();
  await fireEvent.focus(content("other-left"));
  await waitFor(() =>
    expect(content("other-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("Backspace");
  await key("z", { ctrlKey: true });
  await waitFor(() =>
    expect(content("other-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
  );
  await key("!");
  await save();
  expect(disk.root[0].left).toEqual([
    { id: "flat-1-left", text: "first" },
    { id: "other-left", text: "!second" },
  ]);
});

it("keeps paste separate from adjacent typing", async () => {
  await opened();
  await key("X");
  await fireEvent.paste(screen.getByTestId("editor-sink"), {
    clipboardData: { getData: () => "paste" },
  });
  await key("Y");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("XpasteFirst note");
  await key("z", { ctrlKey: true });
  expect(content("flat-1-right")).toHaveTextContent("XFirst note");
  await key("z", { ctrlKey: true });
  await save();
  expect(disk).toEqual(original);
});

it.each([false, true])("arrows follow the same cell routes (Shift: %s)", async shiftKey => {
  disk.root[0].left[0].text = "Parent left";
  disk.root[0].right.children = [
    { id: "child-a", left: [{ id: "child-a-left", text: "Child left" }], right: { id: "child-a-right", text: "Child right", children: [] } },
    { id: "child-b", left: [{ id: "child-b-left", text: "Bottom left" }], right: { id: "child-b-right", text: "Bottom right", children: [] } },
  ];
  await opened();
  const focused = async (id: string) => {
    await waitFor(() => expect(content(id).querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  };
  const move = async (arrow: string, id: string) => {
    if (!shiftKey) await key(arrow === "ArrowUp" || arrow === "ArrowLeft" ? "Home" : "End", { ctrlKey: true });
    await key(arrow, { shiftKey });
    await focused(id);
  };
  await key("ArrowRight"); // Navigation must work inside text, without reaching an edge.
  await move("ArrowRight", "child-a-left");
  await move("ArrowLeft", "flat-1-right");
  await move("ArrowLeft", "flat-1-left");
  await move("ArrowRight", "flat-1-right");
  await move("ArrowDown", "child-a-left");
  await move("ArrowUp", "flat-1-right");
  await move("ArrowDown", "child-a-left");
  await move("ArrowDown", "child-b-left");
  await move("ArrowUp", "child-a-left");
  await move("ArrowRight", "child-a-right");
  await move("ArrowDown", "child-b-right");
  await move("ArrowUp", "child-a-right");
  await move("ArrowUp", "flat-1-right");
  await move("ArrowUp", "flat-1-right"); // No right cell above the first row.
  await move("ArrowRight", "child-a-left");
  await move("ArrowRight", "child-a-right");
  await move("ArrowDown", "child-b-right");
  await move("ArrowDown", "flat-2-right");
  await move("ArrowUp", "child-b-left");
  await move("ArrowUp", "child-a-left");
  await move("ArrowUp", "flat-1-right");
  await move("ArrowDown", "child-a-left");
  await move("ArrowDown", "child-b-left");
  await move("ArrowDown", "flat-2-right");
  await move("ArrowLeft", "flat-2-left");
  await move("ArrowUp", "flat-1-left");
  await move("ArrowLeft", "flat-1-left"); // No destination keeps focus in place.
  await key("Home", { ctrlKey: true });
  await key("!");
  await save();
  expect(disk.root[0].left[0].text).toBe("!Parent left");
  expect(disk.root[0].right.text).toBe("First note");
  expect(disk.root[0].right.children[0].left[0].text).toBe("Child left");
});

it("Shift Right wraps through three child records and Shift Left reverses the sequence", async () => {
  disk.root[0].right.children = [1, 2, 3].map(number => ({
    id: `child-${number}`,
    left: [{ id: `child-${number}-left`, text: `Left ${number}` }],
    right: { id: `child-${number}-right`, text: `Right ${number}`, children: [] },
  }));
  await opened();
  const sequence = [
    "flat-1-right",
    "child-1-left", "child-1-right",
    "child-2-left", "child-2-right",
    "child-3-left", "child-3-right",
    "flat-2-left", "flat-2-right",
  ];
  for (const id of sequence.slice(1)) {
    await key("ArrowRight", { shiftKey: true });
    await waitFor(() => expect(content(id).querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  }
  await key("ArrowRight", { shiftKey: true });
  expect(content("flat-2-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus();
  for (const id of sequence.slice(0, -1).reverse()) {
    await key("ArrowLeft", { shiftKey: true });
    await waitFor(() => expect(content(id).querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  }
  await save();
  expect(disk).toEqual({ ...original, root: [
    { ...original.root[0], right: { ...original.root[0].right, children: [1, 2, 3].map(number => ({
      id: `child-${number}`,
      left: [{ id: `child-${number}-left`, text: `Left ${number}` }],
      right: { id: `child-${number}-right`, text: `Right ${number}`, children: [] },
    })) } },
    original.root[1],
  ] });
});

it("edits the parent row in a deeper layer and preserves edits when leaving and reentering", async () => {
  disk = JSON.parse(readFileSync("fixtures/three-levels.json", "utf8"));
  await opened();
  await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Child note" }));
  await waitFor(() => expect(content("grandchild-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  const parentRow = screen.getByTestId("parent-level");
  expect(parentRow.querySelectorAll("[data-content-id]")).toHaveLength(1);
  expect(parentRow.querySelector('[data-content-id="child-left"]')).not.toBeInTheDocument();
  expect(parentRow.querySelector('[data-content-id="child-right"]')).toBeInTheDocument();
  expect(document.querySelectorAll('[data-content-id="grandchild-right"]')).toHaveLength(1);
  content("child-right").focus();
  await waitFor(() => expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await key("!");
  await key("z", { ctrlKey: true });
  await waitFor(() => expect(content("child-right")).toHaveTextContent("Child note"));
  await key("z", { ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(content("child-right")).toHaveTextContent("!Child note"));
  await waitFor(() => expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await save();
  expect(disk.root[0].right.children[0].right.text).toBe("!Child note");
  expect(disk.root[0].right.children[0].left[0].text).toBe("");
  await key(",", { ctrlKey: true });
  await waitFor(() => expect(window.location.hash).toBe("#/c/root"));
  expect(content("child-right")).toHaveTextContent("!Child note");
  expect(content("child-left")).toHaveTextContent("");
  await fireEvent.click(screen.getByRole("button", { name: "Go deeper into !Child note" }));
  await waitFor(() => expect(window.location.hash).toBe("#/c/root/child"));
  expect(screen.getByTestId("parent-level")).toHaveTextContent("!Child note");
  await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
  content("grandchild-right").focus();
  await waitFor(() => expect(content("grandchild-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await key("ArrowUp", { shiftKey: true });
  await waitFor(() => expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await key("ArrowLeft", { shiftKey: true });
  expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus();
  await key("ArrowRight", { shiftKey: true });
  await waitFor(() => expect(content("grandchild-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await key("ArrowUp", { shiftKey: true });
  await waitFor(() => expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
});

it("focuses and types beside navigation arrows before and after the cell is active", async () => {
  disk = JSON.parse(readFileSync("fixtures/three-levels.json", "utf8"));
  await opened();
  content("child-right").focus();
  await waitFor(() => expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  for (let click = 0; click < 2; click++) {
    await fireEvent.mouseDown(content("root-right"), { button: 0, clientX: 20, clientY: 100 });
    await waitFor(() => expect(content("root-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
    await key("!");
    expect(content("root-right")).toHaveTextContent("!");
    expect(window.location.hash).toBe("#/");
  }
  await fireEvent.click(screen.getByRole("button", { name: "Go deeper into Child note" }));
  await waitFor(() => expect(content("grandchild-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  for (let click = 0; click < 2; click++) {
    await fireEvent.mouseDown(content("child-right"), { button: 0, clientX: 20, clientY: 100 });
    await waitFor(() => expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
    await key("!");
    expect(content("child-right")).toHaveTextContent("!");
    expect(window.location.hash).toBe("#/c/root/child");
  }
  await fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  await waitFor(() => expect(window.location.hash).toBe("#/c/root"));
});

it("edits, saves, undoes, and redoes the document title", async () => {
  await opened();
  const title = screen.getByRole("textbox", { name: "Document title" });
  title.focus();
  await fireEvent.input(title, { target: { value: "Updated title" } });
  await fireEvent.keyDown(title, { key: "s", ctrlKey: true });
  await waitFor(() => expect(disk.title).toBe("Updated title"));
  expect(disk.root).toEqual(original.root);
  await fireEvent.keyDown(title, { key: "z", ctrlKey: true });
  await tick();
  expect(title).toHaveValue(original.title);
  expect(title).toHaveFocus();
  await fireEvent.keyDown(title, { key: "z", ctrlKey: true, shiftKey: true });
  await tick();
  expect(title).toHaveValue("Updated title");
  await fireEvent.blur(title);
  await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  expect(disk.title).toBe("Updated title");
});

it("saves composed title text only after composition finishes", async () => {
  await opened();
  const title = screen.getByRole("textbox", { name: "Document title" });
  title.focus();
  await fireEvent.compositionStart(title);
  await fireEvent.input(title, { target: { value: "にほん" }, isComposing: true });
  await fireEvent.keyDown(title, { key: "s", ctrlKey: true, isComposing: true });
  expect(puts).toHaveLength(0);
  await fireEvent.compositionEnd(title, { target: { value: "日本語" }, data: "日本語" });
  await fireEvent.keyDown(title, { key: "Enter" });
  await waitFor(() => expect(disk.title).toBe("日本語"));
});

it("autosaves the title while the title field remains focused", async () => {
  await opened();
  const title = screen.getByRole("textbox", { name: "Document title" });
  title.focus();
  await fireEvent.input(title, { target: { value: "Autosaved title" } });
  await waitFor(() => expect(disk.title).toBe("Autosaved title"), { timeout: 2500 });
  expect(title).toHaveFocus();
});

it.each([[false, false], [false, true], [true, false], [true, true]])("Left selects the first left record (nested: %s, Shift: %s)", async (nested, shiftKey) => {
  const row = {
    id: "multiple-left",
    left: [1, 2, 3].map(number => ({ id: `multiple-left-${number}`, text: `Left ${number}` })),
    right: { id: "multiple-right", text: "Right note", children: [] },
  };
  if (nested) disk.root[0].right.children = [row];
  else disk.root[0] = row;
  await opened();
  if (nested) content("multiple-right").focus();
  await waitFor(() => expect(content("multiple-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  if (!shiftKey) await key("Home", { ctrlKey: true });
  await key("ArrowLeft", { shiftKey });
  await waitFor(() => expect(content("multiple-left-1").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await key("Home", { ctrlKey: true });
  await key("!");
  await save();
  const saved = nested ? disk.root[0].right.children[0] : disk.root[0];
  expect(saved.left.map(note => note.text)).toEqual(["!Left 1", "Left 2", "Left 3"]);
});

it.each([[false, false], [false, true], [true, false], [true, true]])("Right from any left record goes to its right cell (nested: %s, Shift: %s)", async (nested, shiftKey) => {
  const row = {
    id: "multiple-left",
    left: [1, 2, 3].map(number => ({ id: `multiple-left-${number}`, text: `Left ${number}` })),
    right: { id: "multiple-right", text: "Right note", children: [] },
  };
  if (nested) disk.root[0].right.children = [row];
  else disk.root[0] = row;
  await opened();
  for (const note of row.left) {
    content(note.id).focus();
    await waitFor(() => expect(content(note.id).querySelector('[data-testid="editor-sink"]')).toHaveFocus());
    if (!shiftKey) await key("End", { ctrlKey: true });
    await key("ArrowRight", { shiftKey });
    await waitFor(() => expect(content("multiple-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  }
  await key("!");
  await save();
  const saved = nested ? disk.root[0].right.children[0] : disk.root[0];
  expect(saved.left).toEqual(row.left);
  expect(saved.right.text).toBe("!Right note");
});

it("Shift Enter from a left cell creates a sibling row and can be undone", async () => {
  disk.root[0].left[0].text = "left tail";
  await opened();
  content("flat-1-left").focus();
  await waitFor(() => expect(content("flat-1-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  for (let column = 0; column < 5; column++) await key("ArrowRight");
  await key("Enter", { shiftKey: true });
  await waitFor(() => expect(document.querySelector('[data-testid="editor-sink"]')?.closest('[aria-label="Left note"]')).not.toBeNull());
  await key("!");
  await save();
  expect(disk.root).toHaveLength(3);
  expect(disk.root[0].left[0].text).toBe("left ");
  expect(disk.root[1].left[0].text).toBe("!tail");
  expect(disk.root[1].right.text).toBe("");
  expect(disk.root[0].right.text).toBe(original.root[0].right.text);
  await key("z", { ctrlKey: true });
  await key("z", { ctrlKey: true });
  await save();
  expect(disk.root).toHaveLength(2);
  expect(disk.root[0].left[0].text).toBe("left tail");
});

it.each(["left", "right"])("Alt Enter no longer creates records from the %s column", async side => {
  await opened();
  if (side === "left") {
    content("flat-1-left").focus();
    await waitFor(() => expect(content("flat-1-left").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  }
  await key("Enter", { altKey: true });
  await save();
  expect(disk.root).toHaveLength(2);
  expect(disk.root[0].left).toHaveLength(1);
  expect(disk.root[0].right.children).toEqual([]);
});

it("updates total layer depth when creating children and undoing them", async () => {
  await opened();
  const status = screen.getByRole("status", { name: "Current layer" });
  expect(status).toHaveTextContent("1:1");
  await key("Enter", { ctrlKey: true });
  await waitFor(() => expect(status).toHaveTextContent("1:2"));
  await key("Enter", { ctrlKey: true });
  await waitFor(() => expect(status).toHaveTextContent("3:3"));
  await key("z", { ctrlKey: true });
  await waitFor(() => expect(status).toHaveTextContent("1:2"));
  await key("z", { ctrlKey: true });
  await waitFor(() => expect(status).toHaveTextContent("1:1"));
});

it("activates a 5000-line preview without replacing or measuring every line", async () => {
  const text = JSON.parse(readFileSync("fixtures/long.json", "utf8")).root[0].right.text;
  const target = disk.root[1].right;
  target.text = text;
  await opened();
  const note = content(target.id);
  const preview = note.querySelector('[data-testid="editor-preview"]');
  const lines = [...note.querySelectorAll<HTMLElement>("[data-line]")];
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.length).toBeLessThan(100);
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  await fireEvent.mouseDown(lines[0]!.firstElementChild!, { button: 0, clientX: 12, clientY: 0 });
  await waitFor(() => expect(note.querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  expect(note.querySelector('[data-testid="editor-surface"]')).toBe(preview);
  expect([...note.querySelectorAll("[data-line]")].every((line, index) => line === lines[index])).toBe(true);
  expect(geometry.mock.calls.length).toBeLessThan(100);
  geometry.mockRestore();
  // jsdom has no text geometry; use Home for a deterministic insertion column.
  await key("Home");
  await key("!");
  await save();
  expect(disk.root[1].right.text).toBe("!" + text);
}, 20000);

it("activates and edits a preview after its document was evicted from the cache", async () => {
  disk.root = Array.from({ length: 60 }, (_, index) => ({
    id: `row-${index}`, left: [{ id: `left-${index}`, text: "Left" }],
    right: { id: `right-${index}`, text: "Right", children: [] },
  }));
  await opened();
  content("left-1").focus();
  await waitFor(() => expect(content("left-1").querySelector('[data-testid="editor-sink"]')).toHaveFocus());
  await key("!");
  await save();
  expect(disk.root[1].left[0].text).toBe("!Left");
});

it("keeps the 10x fixture window bounded through input, newlines, history, and select-all", async () => {
  disk = JSON.parse(readFileSync("fixtures/long-10x.json", "utf8"));
  const initialText = disk.root[0].right.text;
  await opened();
  const surface = screen.getByTestId("editor-surface");
  const bounded = () => expect(surface.querySelectorAll("[data-line]").length).toBeLessThan(100);
  bounded();
  await key("!");
  await key("Enter");
  await key("Backspace");
  await key("z", { ctrlKey: true });
  await key("y", { ctrlKey: true });
  bounded();
  await key("End", { ctrlKey: true });
  expect(surface.querySelector('[data-line="50009"]')).toBeInTheDocument();
  await key("?");
  bounded();
  await key("a", { ctrlKey: true });
  expect(surface.querySelectorAll('[data-testid="editor-selection"]').length).toBeLessThan(100);
  await key("X");
  expect(surface.querySelectorAll("[data-line]")).toHaveLength(1);
  await key("z", { ctrlKey: true });
  bounded();
  await save();
  expect(disk.root[0].right.text).toBe("!" + initialText + "?");
}, 20000);

it("keeps the 5000-line editor and unchanged line elements mounted during undo and redo", async () => {
  disk = JSON.parse(readFileSync("fixtures/long.json", "utf8"));
  await opened();
  const sink = screen.getByTestId("editor-sink");
  const surface = screen.getByTestId("editor-surface");
  const unchangedLine = surface.querySelector('[data-line="10"]');
  const initialText = disk.root[0].right.text;
  await key("!");
  await key("z", { ctrlKey: true });
  expect(screen.getByTestId("editor-sink")).toBe(sink);
  expect(screen.getByTestId("editor-surface")).toBe(surface);
  expect(surface.querySelector('[data-line="10"]')).toBe(unchangedLine);
  expect(surface.querySelector('[data-line="0"]')?.textContent).toBe(initialText.split("\n")[0]);
  await key("y", { ctrlKey: true });
  expect(screen.getByTestId("editor-sink")).toBe(sink);
  expect(surface.querySelector('[data-line="10"]')).toBe(unchangedLine);
  expect(surface.querySelector('[data-line="0"]')?.textContent).toBe("!" + initialText.split("\n")[0]);
  await key("?");
  await save();
  expect(disk.root[0].right.text).toBe("!?" + initialText);
}, 20000);

it("keeps unchanged long-fixture lines mounted across Enter, undo, redo, and joining", async () => {
  disk = JSON.parse(readFileSync("fixtures/long.json", "utf8"));
  const initialText = disk.root[0].right.text;
  await opened();
  const surface = screen.getByTestId("editor-surface");
  const unchanged = surface.querySelector('[data-line="10"]');
  await key("Enter");
  expect(surface.querySelector('[data-line="11"]')).toBe(unchanged);
  await key("z", { ctrlKey: true });
  expect(surface.querySelector('[data-line="10"]')).toBe(unchanged);
  await key("y", { ctrlKey: true });
  expect(surface.querySelector('[data-line="11"]')).toBe(unchanged);
  await key("Backspace");
  expect(surface.querySelector('[data-line="10"]')).toBe(unchanged);
  await save();
  expect(disk.root[0].right.text).toBe(initialText);
}, 20000);
