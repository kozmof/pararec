import { parseSchema, type Schema } from "../../schema.js";
export type RecoverySnapshot = { schema: Schema; base: Schema; savedAt: number };
export interface RecoveryStorage {
  read(): Promise<RecoverySnapshot | null>;
  write(snapshot: RecoverySnapshot): Promise<void>;
  clear(): Promise<void>;
}

/** Queue operations so an older acknowledgement cannot erase a newer local snapshot. */
export class IndexedRecovery implements RecoveryStorage {
  #queue: Promise<unknown> = Promise.resolve();
  #database: Promise<IDBDatabase> | null = null;
  constructor(private key: string = `${location.origin}/api/document`) {}
  #open(): Promise<IDBDatabase> {
    if (!this.#database)
      this.#database = new Promise((resolve, reject) => {
        const request = indexedDB.open("pararec-recovery", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("documents");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.#database = null;
          reject(request.error ?? new Error("Recovery storage is unavailable"));
        };
        request.onblocked = () => {
          this.#database = null;
          reject(new Error("Recovery storage is blocked"));
        };
      });
    return this.#database;
  }
  #run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const next = this.#queue
      .catch(() => {})
      .then(async () => {
        const database = await this.#open();
        return new Promise<T>((resolve, reject) => {
          const transaction = database.transaction("documents", mode);
          const request = action(transaction.objectStore("documents"));
          transaction.oncomplete = () => resolve(request.result as T);
          transaction.onerror = transaction.onabort = () =>
            reject(transaction.error ?? new Error("Recovery storage failed"));
        });
      });
    this.#queue = next;
    return next;
  }
  async read(): Promise<RecoverySnapshot | null> {
    const value = await this.#run<RecoverySnapshot | undefined>("readonly", (store) =>
      store.get(this.key),
    );
    return value
      ? { schema: parseSchema(value.schema), base: parseSchema(value.base), savedAt: value.savedAt }
      : null;
  }
  async write(snapshot: RecoverySnapshot): Promise<void> {
    await this.#run("readwrite", (store) => store.put(snapshot, this.key));
  }
  async clear(): Promise<void> {
    await this.#run("readwrite", (store) => store.delete(this.key));
  }
}
