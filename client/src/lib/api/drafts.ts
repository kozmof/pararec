import { parseSchema, type Schema } from "../../schema.js";

export type Draft = {
  id: string;
  documentId: string;
  etag: string | null;
  schema: Schema;
  updatedAt: number;
  version: string;
};

const DATABASE = "pararec-recovery";
const STORE = "drafts";
export const RECOVERY_ERROR =
  "Browser draft recovery is unavailable. Keep this page open until your notes are saved to disk.";

function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let database: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let finished = false;
    const timer = setTimeout(() => fail(), 5000);
    function fail() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        tx?.abort();
      } catch {
        /* The transaction may already have aborted. */
      }
      database?.close();
      reject(new Error(RECOVERY_ERROR));
    }
    try {
      const open = indexedDB.open(DATABASE, 1);
      open.onupgradeneeded = () => {
        open.result
          .createObjectStore(STORE, { keyPath: "id" })
          .createIndex("documentId", "documentId");
      };
      open.onerror = fail;
      open.onblocked = fail;
      open.onsuccess = () => {
        database = open.result;
        if (finished) {
          database.close();
          return;
        }
        database.onversionchange = () => database?.close();
        try {
          tx = database.transaction(STORE, mode, { durability: "strict" });
          const request = operation(tx.objectStore(STORE));
          tx.onerror = fail;
          tx.onabort = fail;
          tx.oncomplete = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            database?.close();
            resolve(request.result);
          };
        } catch {
          fail();
        }
      };
    } catch {
      fail();
    }
  });
}

export async function readDrafts(documentId: string, diskSchema?: Schema): Promise<Draft[]> {
  const records: unknown[] = await transaction("readonly", (store) =>
    store.index("documentId").getAll(documentId),
  );
  const drafts = records
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const record = value as Partial<Draft>;
      if (
        record.documentId !== documentId ||
        typeof record.id !== "string" ||
        typeof record.version !== "string" ||
        typeof record.updatedAt !== "number" ||
        !Number.isFinite(record.updatedAt) ||
        (record.etag !== null && typeof record.etag !== "string")
      )
        return [];
      try {
        return [{ ...record, schema: parseSchema(record.schema) } as Draft];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!diskSchema || drafts.length === 0) return drafts;
  const disk = JSON.stringify(diskSchema);
  const unsaved: Draft[] = [];
  for (const draft of drafts) {
    // A tab may have closed after the disk write but before deleting its draft.
    if (JSON.stringify(draft.schema) === disk) await deleteDraft(draft.id, draft.version);
    else unsaved.push(draft);
  }
  return unsaved;
}

export async function writeDraft(draft: Draft): Promise<void> {
  await transaction("readwrite", (store) => store.put(draft));
}

export async function deleteDraft(id: string, version?: string): Promise<void> {
  if (version === undefined) {
    await transaction("readwrite", (store) => store.delete(id));
    return;
  }
  await transaction("readwrite", (store) => {
    const request: IDBRequest<Draft | undefined> = store.get(id);
    request.onsuccess = () => {
      if (request.result?.version === version) store.delete(id);
    };
    return request;
  });
}
