import { afterEach, expect, it, vi } from "vitest";
import { loadDocument } from "./document.js";
afterEach(() => vi.unstubAllGlobals());
it("loads and validates the document with its ETag", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ version: 1, root: [] }), { headers: { ETag: '"v1"' } }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await loadDocument()).toEqual({ schema: { version: 1, root: [] }, etag: '"v1"' });
  expect(fetch).toHaveBeenCalledWith("/api/document", { signal: undefined, cache: "no-store" });
});
it("opens a missing file as an empty unsaved document", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  expect(await loadDocument()).toEqual({ schema: { version: 1, root: [] }, etag: null });
});
it.each([
  new Response(null, { status: 500 }),
  new Response('{"version":1,"root":[]}'),
  new Response('{"version":2,"root":[]}', { headers: { ETag: '"v1"' } }),
])("rejects failed or invalid responses", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(loadDocument()).rejects.toThrow();
});
