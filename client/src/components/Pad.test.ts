import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import Pad from "./Pad.svelte";
import { IndexedRecovery } from "../lib/api/recovery.js";
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
  vi.spyOn(IndexedRecovery.prototype, "read").mockResolvedValue(null);
  vi.spyOn(IndexedRecovery.prototype, "write").mockResolvedValue();
  vi.spyOn(IndexedRecovery.prototype, "clear").mockResolvedValue();
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
  it("shows one level of nested children and badges for deeper levels", async () => {
    await opened();
    expect(content("root-right")).toHaveTextContent("Root note");
    expect(content("child-right")).toHaveTextContent("Child note");
    expect(content("grandchild-right")).toBeNull();
    expect(screen.getByRole("button", { name: "Open children of Child note" })).toHaveTextContent(
      "1 child",
    );
    await waitFor(() =>
      expect(content("root-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
    expect(screen.getAllByTestId("editor-sink")).toHaveLength(1);
    expect(screen.getByTestId("pad-level")).toHaveAttribute("data-etag", '"v1"');
  });
  it("enters visible nested Containers and restores focus through breadcrumbs", async () => {
    await opened();
    content("child-right").focus();
    await fireEvent.click(screen.getByRole("button", { name: "Open children of Child note" }));
    await waitFor(() => expect(window.location.hash).toBe("#/c/root/child"));
    await waitFor(() =>
      expect(
        content("grandchild-right").querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await fireEvent.click(screen.getByRole("button", { name: /^Root$/ }));
    await waitFor(() =>
      expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
  });
  it("navigates down and up with Control and suppresses composition keys", async () => {
    await opened();
    content("root-right").focus();
    await key(".", true);
    expect(window.location.hash).toBe("#/");
    await key(".");
    await waitFor(() =>
      expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
    await key(".");
    await waitFor(() =>
      expect(
        content("grandchild-right").querySelector('[data-testid="editor-sink"]'),
      ).toHaveFocus(),
    );
    await key(",");
    await waitFor(() =>
      expect(content("child-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
    await key(",");
    await waitFor(() =>
      expect(content("root-right").querySelector('[data-testid="editor-sink"]')).toHaveFocus(),
    );
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
    expect(document.querySelectorAll("[data-container-id]")).toHaveLength(1);
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
    expect(IndexedRecovery.prototype.write).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("editor-sink")).toHaveFocus());
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
