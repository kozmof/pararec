import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexedRecovery, type RecoverySnapshot } from "./recovery.js";
let data: Map<string, unknown>;
let abortNext: boolean;
// Exercise the adapter's transaction completion and failure handling without browser layout.
beforeEach(() => {
  data = new Map();
  abortNext = false;
  const database = {
    createObjectStore: vi.fn(),
    transaction() {
      const transaction: {
        oncomplete?: () => void;
        onabort?: () => void;
        error?: Error;
        objectStore?: () => unknown;
      } = {};
      function request(action: () => unknown) {
        const request: { result?: unknown } = {};
        queueMicrotask(() => {
          if (abortNext) {
            abortNext = false;
            transaction.error = new Error("Quota exceeded");
            transaction.onabort?.();
          } else {
            request.result = action();
            transaction.oncomplete?.();
          }
        });
        return request;
      }
      transaction.objectStore = () => ({
        get: (key: string) => request(() => data.get(key)),
        put: (value: unknown, key: string) =>
          request(() => {
            data.set(key, JSON.parse(JSON.stringify(value)));
            return key;
          }),
        delete: (key: string) => request(() => data.delete(key)),
      });
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", {
    open() {
      const request: { result: typeof database; onsuccess?: () => void } = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
const snapshot: RecoverySnapshot = {
  schema: { version: 1, root: [] },
  base: { version: 1, root: [] },
  savedAt: 1,
};
it("serializes writes and clears so a new edit survives an older save acknowledgement", async () => {
  const recovery = new IndexedRecovery("document");
  const first = recovery.write(snapshot),
    clear = recovery.clear(),
    latest = recovery.write({ ...snapshot, savedAt: 2 });
  await Promise.all([first, clear, latest]);
  expect((await recovery.read())?.savedAt).toBe(2);
});
it("separates recovery records for different document endpoints", async () => {
  const one = new IndexedRecovery("origin/one"),
    two = new IndexedRecovery("origin/two");
  await one.write(snapshot);
  expect(await two.read()).toBeNull();
  await two.write({ ...snapshot, savedAt: 2 });
  await one.clear();
  expect((await two.read())?.savedAt).toBe(2);
});
it("rejects aborted writes and allows subsequent operations to recover", async () => {
  const recovery = new IndexedRecovery("document");
  abortNext = true;
  await expect(recovery.write(snapshot)).rejects.toThrow("Quota exceeded");
  await recovery.write(snapshot);
  expect(await recovery.read()).toEqual(snapshot);
});
it("validates recovery documents before restoring them", async () => {
  data.set("document", { ...snapshot, schema: { version: 2, root: [] } });
  await expect(new IndexedRecovery("document").read()).rejects.toThrow("Unsupported version");
});
