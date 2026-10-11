import { afterEach, expect, it, vi } from "vitest";
import { boundedRequest, REQUEST_TIMEOUT_MS } from "./request.js";
import { SaveSession } from "./save-session.svelte.js";
import { parseSchema } from "../../schema.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("aborts a stalled save, preserves edits, and allows retry", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(new Promise(() => {}))
    .mockResolvedValueOnce(new Response(null, { status: 204, headers: { ETag: '"next"' } }));
  vi.stubGlobal("fetch", fetch);
  const session = new SaveSession({ schema: parseSchema({ version: 1, root: [] }), etag: '"old"' });
  session.changed(parseSchema({ version: 1, title: "Unsaved", root: [] }));
  const saving = session.flush();
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  await saving;
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(session.status).toBe("failed");
  expect(session.error).toContain("15 seconds");
  expect(session.dirty).toBe(true);
  await session.flush();
  expect(session.status).toBe("saved");
  session.dispose();
});

it("bounds response processing as well as receiving headers", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const result = boundedRequest(async (requestSignal) => {
    signal = requestSignal;
    return new Promise(() => {});
  });
  const assertion = expect(result).rejects.toThrow("15 seconds");
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  await assertion;
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels an in-flight save on disposal without reporting a failure", async () => {
  const fetch = vi.fn().mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", fetch);
  const schema = parseSchema({ version: 1, root: [] });
  const session = new SaveSession({ schema, etag: '"old"' });
  session.changed(schema);
  const saving = session.flush();
  session.dispose();
  await saving;
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(session.dirty).toBe(true);
  expect(session.error).toBe("");
});
