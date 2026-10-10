import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import EditorSurface from "./EditorSurface.svelte";
import { EditorDocument } from "./document-store.svelte.js";

class Observer {
  static instances: Observer[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(private callback: ResizeObserverCallback) {
    Observer.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  emit(entries: { element: Element; height: number; width?: number }[]) {
    this.callback(
      entries.map(({ element, height, width = 600 }) => ({
        target: element,
        contentRect: { width, height },
      })) as ResizeObserverEntry[],
      this as unknown as ResizeObserver,
    );
  }
}
const opened: EditorDocument[] = [];
function mount(text: string, props: Record<string, unknown> = {}) {
  const doc = new EditorDocument(text);
  opened.push(doc);
  const view = render(EditorSurface, { props: { doc, ...props } });
  return { doc, view, surface: screen.getByTestId(props.readonly ? "editor-preview" : "editor-surface") as HTMLDivElement };
}
const line = (at: number) => document.querySelector(`[data-line="${at}"]`) as HTMLElement;
beforeEach(() => {
  Observer.instances = [];
  vi.stubGlobal("ResizeObserver", Observer);
});
afterEach(() => {
  for (const doc of opened.splice(0)) doc.dispose();
  vi.unstubAllGlobals();
});

async function settled() {
  await tick();
  await tick();
}

describe("measured surface", () => {
  it("remeasures edited lines whose DOM height does not change", async () => {
    const { doc, surface } = mount("one\ntwo", { autoHeight: true });
    const first = line(0);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({ height: 60 } as DOMRect);
    Observer.instances[0].emit([{ element: first, height: 60 }]);
    await settled();
    expect(surface.style.height).toBe("96px");
    doc.insert({ line: 0, column: 3 }, "!");
    await settled();
    // No second ResizeObserver notification: the physical height was unchanged.
    expect(surface.style.height).toBe("96px");
    expect(line(1).style.top).toBe("68px");
  });

  it("uses one observer, publishes measured height, and removes observed nodes on unmount", async () => {
    const onHeight = vi.fn();
    const { surface, view } = mount("one\ntwo", { autoHeight: true, onHeight });
    await settled();
    expect(Observer.instances).toHaveLength(1);
    const observer = Observer.instances[0];
    expect(observer.observed.size).toBe(3); // Surface and both rendered lines.
    expect(surface.style.height).toBe("56px");
    observer.emit([{ element: line(0), height: 60 }]);
    await settled();
    expect(line(1).style.top).toBe("68px");
    expect(surface.style.height).toBe("96px");
    expect(onHeight).toHaveBeenLastCalledWith(96);
    view.unmount();
    expect(observer.disconnected).toBe(true);
    expect(observer.observed.size).toBe(0);
  });

  it("renders every line in auto-height mode and splices height on edit and undo", async () => {
    const { surface, doc } = mount(
      Array.from({ length: 100 }, (_, at) => `line ${at}`).join("\n"),
      { autoHeight: true },
    );
    expect(document.querySelectorAll("[data-line]")).toHaveLength(100);
    expect(surface.style.overflow).toBe("visible");
    doc.insert({ line: 0, column: 0 }, "new\n");
    await settled();
    expect(document.querySelectorAll("[data-line]")).toHaveLength(101);
    expect(surface.style.height).toBe("2036px");
    doc.undo();
    await settled();
    expect(document.querySelectorAll("[data-line]")).toHaveLength(100);
    expect(surface.style.height).toBe("2016px");
  });

  it("preserves the scroll anchor when a rendered line above it grows", async () => {
    const { surface } = mount(Array.from({ length: 100 }, (_, at) => `line ${at}`).join("\n"));
    surface.scrollTop = 55;
    await fireEvent.scroll(surface);
    Observer.instances[0].emit([{ element: line(0), height: 60 }]);
    await settled();
    expect(surface.scrollTop).toBe(95);
    expect(line(2).style.top).toBe("88px");
  });

  it("processes width invalidation before fresh line measurements regardless of entry order", async () => {
    const { surface } = mount("one\ntwo", { autoHeight: true });
    Observer.instances[0].emit([
      { element: line(0), height: 60 },
      { element: surface, height: 96, width: 400 },
    ]);
    await settled();
    expect(surface.style.height).toBe("96px");
    expect(line(1).style.top).toBe("68px");
  });

  it("shares the same line nodes and height across read-only and editable modes", async () => {
    const { surface, doc, view } = mount("日本😀\nsecond", { autoHeight: true, readonly: true });
    const first = line(0);
    expect(screen.queryByTestId("editor-sink")).toBeNull();
    expect(screen.queryByTestId("editor-cursor")).toBeNull();
    expect(surface.style.height).toBe("56px");
    await view.rerender({ doc, autoHeight: true, readonly: false });
    await fireEvent.focus(screen.getByTestId("editor-sink"));
    await settled();
    expect(line(0)).toBe(first);
    expect(surface.style.height).toBe("56px");
    expect(screen.getByTestId("editor-cursor")).toBeInTheDocument();
    await view.rerender({ doc, autoHeight: true, readonly: true });
    expect(line(0)).toBe(first);
    expect(screen.queryByTestId("editor-sink")).toBeNull();
    expect(screen.queryByTestId("editor-selection")).toBeNull();
  });
});

it("starts focused layout from the measured preview heights", async () => {
  const { surface } = mount("日本語\nsecond", {
    autoHeight: true,
    initialMeasurements: { width: 200, heights: [60, 40] },
  });
  await settled();
  expect(surface.style.height).toBe("116px");
  expect(line(1).style.top).toBe("68px");
});
