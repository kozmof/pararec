import { afterEach, expect, it, vi } from "vitest";
import { loadDocument } from "./document.js";
afterEach(() => vi.unstubAllGlobals());
it("loads and validates the document with its ETag", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          title: "document",
          config: {
            showTitles: true, maxWidth: 1100,
            outerWidthRate: { left: 35, right: 65 },
            innerIdthRate: { left: 35, right: 65 },
          },
          root: [],
        }),
        { headers: { ETag: '"v1"' } },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await loadDocument()).toEqual({
    schema: {
      version: 1,
      title: "document",
      config: {
        showTitles: true, maxWidth: 1100,
        outerWidthRate: { left: 35, right: 65 },
        innerIdthRate: { left: 35, right: 65 },
      },
      root: [],
    },
    etag: '"v1"',
  });
  expect(fetch).toHaveBeenCalledWith("/api/document", { signal: undefined, cache: "no-store" });
});
it("opens a missing file as an empty unsaved document", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  expect(await loadDocument()).toEqual({
    schema: {
      version: 1,
      title: "document",
      config: {
        showTitles: true, maxWidth: 1100,
        outerWidthRate: { left: 35, right: 65 },
        innerIdthRate: { left: 35, right: 65 },
      },
      root: [],
    },
    etag: null,
  });
});
it.each([
  new Response(null, { status: 500 }),
  new Response('{"version":1,"root":[]}'),
  new Response('{"version":2,"root":[]}', { headers: { ETag: '"v1"' } }),
])("rejects failed or invalid responses", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(loadDocument()).rejects.toThrow();
});
it("explains how to recover when the local server cannot be reached", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(loadDocument()).rejects.toThrow("Start pararec serve and retry");
});
it("preserves request cancellation rather than reporting a server outage", async () => {
  const controller = new AbortController();
  controller.abort();
  const error = new DOMException("Aborted", "AbortError");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(loadDocument(controller.signal)).rejects.toBe(error);
});
it("gives actionable read-permission and invalid-file errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response("{broken", { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(
        new Response('{"version":2,"root":[]}', { headers: { ETag: '"v1"' } }),
      ),
  );
  await expect(loadDocument()).rejects.toThrow("Check the file and its permissions");
  await expect(loadDocument()).rejects.toThrow("Invalid JSON");
  await expect(loadDocument()).rejects.toThrow("Unsupported version");
});
