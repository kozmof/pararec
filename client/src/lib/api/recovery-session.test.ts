import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSchema } from "../../schema.js";
import { SaveSession } from "./save-session.svelte.js";
import { deleteDraft, writeDraft, type Draft } from "./drafts.js";

vi.mock("./drafts.js", () => ({
  writeDraft: vi.fn().mockResolvedValue(undefined),
  deleteDraft: vi.fn().mockResolvedValue(undefined),
  RECOVERY_ERROR: "Browser draft recovery is unavailable.",
}));
const schema = parseSchema({ version: 1, title: "disk", root: [] });
const edited = { ...schema, title: "draft" };
const loaded = { schema, etag: '"disk"', documentId: "one-document" };
let session: SaveSession;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeDraft).mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204, headers: { ETag: '"saved"' } })),
  );
  session = new SaveSession(loaded);
});
afterEach(() => {
  session.dispose();
  vi.unstubAllGlobals();
});

it("persists committed edits before autosave and removes only its own saved draft", async () => {
  session.changed(edited);
  await vi.waitFor(() => expect(writeDraft).toHaveBeenCalledOnce());
  const draft = vi.mocked(writeDraft).mock.calls[0][0];
  expect(draft).toMatchObject({ documentId: loaded.documentId, etag: loaded.etag, schema: edited });
  await session.flush();
  await vi.waitFor(() => expect(deleteDraft).toHaveBeenCalledWith(draft.id));
});

it("keeps drafts after failed saves and disposal", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
  session.changed(edited);
  await session.flush();
  session.dispose();
  expect(writeDraft).toHaveBeenCalled();
  expect(deleteDraft).not.toHaveBeenCalled();
});

it("warns when browser storage is unavailable without blocking disk saving", async () => {
  vi.mocked(writeDraft).mockRejectedValue(new Error("Quota exceeded"));
  session.changed(edited);
  await vi.waitFor(() => expect(session.recoveryError).toContain("unavailable"));
  await session.flush();
  expect(session.status).toBe("saved");
});

it.each([
  ['"disk"', "dirty"],
  ['"external"', "conflict"],
] as const)("restores a draft based on %s without writing automatically", async (etag, status) => {
  session.dispose();
  const draft: Draft = {
    id: "recovered",
    documentId: loaded.documentId,
    schema: edited,
    etag,
    updatedAt: Date.now(),
    version: "original",
  };
  session = new SaveSession(loaded, draft);
  expect(session.status).toBe(status);
  expect(session.dirty).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  if (status === "dirty") {
    await session.flush();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual(edited);
    await vi.waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("recovered", "original"));
  }
});

it("coalesces queued edits and deletes after the in-flight draft write finishes", async () => {
  let finish!: () => void;
  vi.mocked(writeDraft).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  session.changed(edited);
  session.changed({ ...edited, title: "newer" });
  await session.flush();
  expect(deleteDraft).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(deleteDraft).toHaveBeenCalledOnce());
  expect(writeDraft).toHaveBeenCalledOnce();
});
