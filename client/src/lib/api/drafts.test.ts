import { afterEach, expect, it, vi } from "vitest";
import { deleteDraft, writeDraft, type Draft } from "./drafts.js";
import { parseSchema } from "../../schema.js";

const draft: Draft = {
  id: "one-tab",
  documentId: "notes",
  etag: '"base"',
  updatedAt: 1,
  version: "original",
  schema: parseSchema({ version: 1, root: [] }),
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reports disabled storage without leaving a timer behind", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("indexedDB", undefined);
  await expect(writeDraft(draft)).rejects.toThrow("Browser draft recovery is unavailable");
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a stalled database open and closes a connection that arrives too late", async () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const open = { onsuccess: null as (() => void) | null, result: { close } };
  vi.stubGlobal("indexedDB", { open: () => open });
  const pending = writeDraft(draft);
  const assertion = expect(pending).rejects.toThrow("Browser draft recovery is unavailable");
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  open.onsuccess?.();
  expect(close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["original", "newer"])(
  "only deletes a recovered draft if its version is still %s",
  async (version) => {
    const request = { result: { ...draft, version }, onsuccess: null as (() => void) | null };
    const remove = vi.fn();
    const store = { get: vi.fn(() => request), delete: remove };
    const tx = {
      objectStore: () => store,
      oncomplete: null as (() => void) | null,
      abort: vi.fn(),
    };
    const database = { transaction: () => tx, close: vi.fn() };
    const open = { onsuccess: null as (() => void) | null, result: database };
    vi.stubGlobal("indexedDB", { open: () => open });
    const pending = deleteDraft(draft.id, "original");
    open.onsuccess?.();
    request.onsuccess?.();
    tx.oncomplete?.();
    await pending;
    expect(store.get).toHaveBeenCalledWith(draft.id);
    if (version === "original") expect(remove).toHaveBeenCalledWith(draft.id);
    else expect(remove).not.toHaveBeenCalled();
    expect(database.close).toHaveBeenCalledOnce();
  },
);
