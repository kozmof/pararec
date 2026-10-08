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
        content(disk.root[1].right.id).querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await key("!");
    await save();
    expect(disk.root[0].left[0].text.startsWith("X")).toBe(true);
    expect(disk.root[1].right.text.startsWith("!")).toBe(true);
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

it("Alt+Enter splits a right note into a sibling and saves both halves together", async () => {
  await opened();
  for (let column = 0; column < 6; column++) await key("ArrowRight");
  await key("Enter", { altKey: true });
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
  await key("Enter", { altKey: true });
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
  await fireEvent.keyDown(sink, { key: "Enter", altKey: true });
  await fireEvent.keyDown(sink, { key: "Enter", ctrlKey: true });
  await fireEvent.keyDown(sink, { key: "ArrowDown", altKey: true });
  await fireEvent.compositionEnd(sink, { data: "日本" });
  await save();
  expect(disk.root).toHaveLength(2);
  expect(disk.root[0].right.text).toBe("日本First note");
  expect(disk.root[0].right.children).toEqual([]);
});
