import { fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorDemo from "./EditorDemo.svelte";
import { EditorDocument } from "./document-store.svelte.js";

describe("editor demo", () => {
  it("edits a fixture note and restores it with undo", async () => {
    render(EditorDemo);
    const sink = screen.getByTestId("editor-sink");
    sink.focus();
    await userEvent.keyboard("X");
    expect(screen.getByText("XFirst note")).toBeInTheDocument();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(screen.getByText("First note")).toBeInTheDocument();
    await fireEvent.compositionStart(sink);
    await fireEvent.compositionEnd(sink, { data: "日本" });
    expect(screen.getByText("日本First note")).toBeInTheDocument();
  });

  it("disposes the document when leaving", () => {
    const dispose = vi.spyOn(EditorDocument.prototype, "dispose");
    const { unmount } = render(EditorDemo);
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
