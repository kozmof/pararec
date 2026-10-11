import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Schema } from "../../schema.js";
import { SaveSession } from "./save-session.svelte.js";
const schema: Schema = {
  version: 1,
  title: "document",
  config: {
    showTitles: true,
    maxWidth: 1100,
    outerWidthRate: { left: 35, right: 65 },
    innerIdthRate: { left: 35, right: 65 },
  },
  root: [],
};
const next: Schema = {
  version: 1,
  title: "document",
  config: {
    showTitles: true,
    maxWidth: 1100,
    outerWidthRate: { left: 35, right: 65 },
    innerIdthRate: { left: 35, right: 65 },
  },
  root: [
    { id: "a", left: [{ id: "l", text: "" }], right: { id: "r", text: "日本", children: [] } },
  ],
};
let session: SaveSession;
let fetchMock: ReturnType<typeof vi.fn>;
const saved = (etag = '"v2"') => new Response(null, { status: 204, headers: { ETag: etag } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(saved()));
  vi.stubGlobal("fetch", fetchMock);
  session = new SaveSession({ schema, etag: '"v1"' });
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("serialized saving", () => {
  it("debounces edits and saves with the loaded ETag", async () => {
    session.changed(next);
    await vi.advanceTimersByTimeAsync(900);
    expect(fetchMock).not.toHaveBeenCalled();
    session.changed(next);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["If-Match"]).toBe('"v1"');
    expect(session.status).toBe("saved");
    expect(session.dirty).toBe(false);
  });
  it("uses the creation precondition for a missing file", async () => {
    session.dispose();
    session = new SaveSession({ schema, etag: null });
    session.changed(next);
    await session.flush();
    expect(fetchMock.mock.calls[0][1].headers["If-None-Match"]).toBe("*");
  });
  it("acknowledges only the sent revision and serializes a follow-up with the returned ETag", async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    session.changed(next);
    const flush = session.flush();
    const newer = {
      ...next,
      root: next.root.map((row) => ({ ...row, right: { ...row.right, text: "new" } })),
    };
    session.changed(newer);
    void session.flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    first.resolve(saved('"v2"'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(session.dirty).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers["If-Match"]).toBe('"v2"');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(newer);
    second.resolve(saved('"v3"'));
    await flush;
    expect(session.dirty).toBe(false);
    expect(session.etag).toBe('"v3"');
  });
  it("keeps failed saves dirty and offers an explicit retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    session.changed(next);
    await session.flush();
    expect(session.status).toBe("failed");
    expect(session.dirty).toBe(true);
    await session.flush();
    expect(session.status).toBe("saved");
  });
  it("suspends autosave on conflict, including subsequent edits", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 412 }));
    session.changed(next);
    await session.flush();
    session.changed(next);
    await vi.advanceTimersByTimeAsync(2000);
    await session.flush();
    expect(session.status).toBe("conflict");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("overwrite fetches a fresh ETag and requires another choice after a second conflict", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(schema), { headers: { ETag: '"external"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    session.changed(next);
    await session.flush();
    await session.overwrite();
    expect(fetchMock.mock.calls[2][1].headers["If-Match"]).toBe('"external"');
    expect(session.status).toBe("conflict");
  });
  it("overwrite uses creation preconditions if the disk file was deleted", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    session.changed(next);
    await session.flush();
    await session.overwrite();
    expect(fetchMock.mock.calls[2][1].headers["If-None-Match"]).toBe("*");
  });
  it("reload waits for the current write and clears queued edits before another save", async () => {
    const first = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(schema), { headers: { ETag: '"reloaded"' } }),
      );
    session.changed(next);
    const flush = session.flush();
    session.changed(next);
    const reload = session.reload();
    expect(fetchMock).toHaveBeenCalledOnce();
    first.resolve(saved());
    await flush;
    await reload;
    expect(session.status).toBe("saved");
    expect(session.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.changed(next);
    await session.flush();
    expect(fetchMock.mock.calls[2][1].headers["If-Match"]).toBe('"reloaded"');
  });
  it("does not acknowledge an in-flight save after disposal", async () => {
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise);
    session.changed(next);
    const flush = session.flush();
    session.dispose();
    first.resolve(saved());
    await flush;
    expect(session.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

it.each(["{broken", '{"version":2,"root":[]}'])(
  "overwrites an invalid disk document: %s",
  async (body) => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(body, { headers: { ETag: '"invalid"' } }));
    session.changed(next);
    await session.flush();
    await session.overwrite();
    expect(fetchMock.mock.calls[2][1].headers["If-Match"]).toBe('"invalid"');
    expect(session.status).toBe("saved");
    expect(session.dirty).toBe(false);
  },
);

it("acknowledges an uncertain save after verifying the disk snapshot", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response('{"error":"SaveOutcomeUncertain"}', { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(next), { headers: { ETag: '"written"' } }));
  session.changed(next);
  await session.flush();
  expect(session.status).toBe("saved");
  expect(session.dirty).toBe(false);
  expect(session.etag).toBe('"written"');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("requires a conflict choice when an uncertain save reads back different content", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response('{"error":"SaveOutcomeUncertain"}', { status: 500 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(schema), { headers: { ETag: '"external"' } }),
    );
  session.changed(next);
  await session.flush();
  expect(session.status).toBe("conflict");
  expect(session.dirty).toBe(true);
  await session.flush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps edits dirty if readback after an uncertain save fails", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response('{"error":"SaveOutcomeUncertain"}', { status: 500 }))
    .mockRejectedValueOnce(new Error("Offline"));
  session.changed(next);
  await session.flush();
  expect(session.status).toBe("failed");
  expect(session.dirty).toBe(true);
});

it("preserves server error codes in save failures", async () => {
  fetchMock.mockResolvedValueOnce(new Response('{"error":"AccessDenied"}', { status: 500 }));
  session.changed(next);
  await session.flush();
  expect(session.status).toBe("failed");
  expect(session.error).toContain("AccessDenied");
});

it("saves edits queued during uncertain-write verification against the verified ETag", async () => {
  const readback = deferred<Response>();
  fetchMock
    .mockResolvedValueOnce(new Response('{"error":"SaveOutcomeUncertain"}', { status: 500 }))
    .mockReturnValueOnce(readback.promise);
  session.changed(next);
  const flush = session.flush();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const newer = { ...next, title: "Newer notes" };
  session.changed(newer);
  readback.resolve(new Response(JSON.stringify(next), { headers: { ETag: '"verified"' } }));
  await flush;
  expect(fetchMock.mock.calls[2][1].headers["If-Match"]).toBe('"verified"');
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(newer);
  expect(session.status).toBe("saved");
  expect(session.dirty).toBe(false);
});
