import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import EditorSurface from "./EditorSurface.svelte";
import { EditorDocument } from "./document-store.svelte.js";

const opened: EditorDocument[] = [];
function mount(text: string, props: Record<string, unknown> = {}) {
  const doc = new EditorDocument(text);
  opened.push(doc);
  render(EditorSurface, { props: { doc, caret: { line: 0, column: 0 }, anchor: null, ...props } });
  return { doc, sink: screen.getByTestId("editor-sink") as HTMLTextAreaElement };
}
afterEach(() => {
  for (const doc of opened.splice(0)) doc.dispose();
});

describe("document extension input", () => {
  it("drops pre-edit on blur and ignores a late composition commit", async () => {
    const { doc, sink } = mount("hello", {
      caret: { line: 0, column: 5 },
      anchor: { line: 0, column: 0 },
    });
    await fireEvent.compositionStart(sink, { data: "" });
    await fireEvent.compositionUpdate(sink, { data: "にほん" });
    await fireEvent.blur(sink);
    expect(window.document.querySelector("[data-preedit]")).toBeNull();
    await fireEvent.compositionEnd(sink, { data: "日本" });
    sink.value = "日本";
    await fireEvent.input(sink);
    expect(doc.text()).toBe("hello");
    expect(doc.canUndo).toBe(false);
  });

  it("deletes a whole grapheme with backspace and Delete", async () => {
    const cluster = "👩‍🚀";
    const { doc, sink } = mount(`a${cluster}b`, { caret: { line: 0, column: 1 + cluster.length } });
    await fireEvent.keyDown(sink, { key: "Backspace" });
    expect(doc.text()).toBe("ab");
    await fireEvent.keyDown(sink, { key: "z", ctrlKey: true });
    expect(doc.text()).toBe(`a${cluster}b`);
    await fireEvent.keyDown(sink, { key: "ArrowLeft" });
    await fireEvent.keyDown(sink, { key: "Delete" });
    expect(doc.text()).toBe("ab");
  });

  it("keeps selected text intact until composition commits and undoes replacement once", async () => {
    const { doc, sink } = mount("hello world", {
      caret: { line: 0, column: 5 },
      anchor: { line: 0, column: 0 },
    });
    const listener = vi.fn();
    doc.subscribeEdits(listener);
    await fireEvent.compositionStart(sink, { data: "" });
    await fireEvent.compositionUpdate(sink, { data: "にほん" });
    expect(doc.text()).toBe("hello world");
    expect(listener).not.toHaveBeenCalled();
    await fireEvent.compositionEnd(sink, { data: "日本" });
    expect(doc.text()).toBe("日本 world");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].kind).toBe("composition");
    doc.undo();
    expect(doc.text()).toBe("hello world");
  });

  it("cancels composition without deleting the selection or changing history", async () => {
    const { doc, sink } = mount("hello", {
      caret: { line: 0, column: 5 },
      anchor: { line: 0, column: 0 },
    });
    await fireEvent.compositionStart(sink, { data: "" });
    await fireEvent.compositionUpdate(sink, { data: "に" });
    await fireEvent.compositionEnd(sink, { data: "" });
    expect(doc.text()).toBe("hello");
    expect(doc.canUndo).toBe(false);
    expect(doc.lastChange).toBeNull();
  });

  it("isolates a composition commit from adjacent typing", async () => {
    const { doc, sink } = mount("");
    await fireEvent.keyDown(sink, { key: "a" });
    await fireEvent.compositionStart(sink, { data: "" });
    await fireEvent.compositionEnd(sink, { data: "日本" });
    await fireEvent.keyDown(sink, { key: "b" });
    expect(doc.text()).toBe("a日本b");
    doc.undo();
    expect(doc.text()).toBe("a日本");
    doc.undo();
    expect(doc.text()).toBe("a");
    doc.undo();
    expect(doc.text()).toBe("");
  });

  it("ends the typing group on blur while retaining undo history", async () => {
    const { doc, sink } = mount("");
    await fireEvent.keyDown(sink, { key: "a" });
    await fireEvent.blur(sink);
    await fireEvent.focus(sink);
    await fireEvent.keyDown(sink, { key: "b" });
    expect(doc.text()).toBe("ab");
    doc.undo();
    expect(doc.text()).toBe("a");
    doc.undo();
    expect(doc.text()).toBe("");
  });
});

it.each([{ isComposing: true }, { keyCode: 229 }, { key: "Process" }])(
  "leaves native IME processing keys alone before compositionstart (%j)",
  async (extra) => {
    const host = vi.fn();
    const { doc, sink } = mount("hello", { onKeydown: host });
    const event = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    await fireEvent(sink, event);
    expect(doc.text()).toBe("hello");
    expect(host).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  },
);
