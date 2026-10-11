import type { Schema } from "../../schema.js";
import { loadDocument, loadDocumentETag, type LoadedDocument } from "./document.js";
import { SaveConflict, saveDocument } from "./save.js";
import { deleteDraft, writeDraft, RECOVERY_ERROR, type Draft } from "./drafts.js";

export class SaveSession {
  status = $state<"saved" | "dirty" | "saving" | "failed" | "conflict">("saved");
  error = $state("");
  recoveryError = $state("");
  etag = $state<string | null>(null);
  #schema: Schema;
  #revision = 0;
  #savedRevision = 0;
  #flight: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #paused = false;
  #disposed = false;
  #controller = new AbortController();
  #documentId?: string;
  #draftId: string;
  #sourceDraft?: Draft;
  #pendingDraft: Draft | null | undefined;
  #persisting = false;
  constructor(loaded: LoadedDocument, draft?: Draft) {
    this.#schema = draft?.schema ?? loaded.schema;
    this.etag = draft ? draft.etag : loaded.etag;
    this.#documentId = loaded.documentId;
    this.#draftId = crypto.randomUUID();
    this.#sourceDraft = draft;
    if (draft) {
      this.#revision = 1;
      this.status = draft.etag === loaded.etag ? "dirty" : "conflict";
      this.#persistSnapshot();
    }
  }
  #persistSnapshot() {
    if (this.#documentId)
      this.#persist({
        id: this.#draftId,
        documentId: this.#documentId,
        etag: this.etag,
        schema: this.#schema,
        updatedAt: Date.now(),
        version: crypto.randomUUID(),
      });
  }
  #persist(draft: Draft | null) {
    if (!this.#documentId) return;
    this.#pendingDraft = draft;
    if (!this.#persisting) void this.#drainDrafts();
  }
  async #drainDrafts() {
    this.#persisting = true;
    while (this.#pendingDraft !== undefined) {
      const draft = this.#pendingDraft;
      this.#pendingDraft = undefined;
      try {
        if (draft) await writeDraft(draft);
        else {
          await deleteDraft(this.#draftId);
          if (this.#sourceDraft) {
            await deleteDraft(this.#sourceDraft.id, this.#sourceDraft.version);
            this.#sourceDraft = undefined;
          }
        }
        this.recoveryError = "";
      } catch {
        this.recoveryError = RECOVERY_ERROR;
      }
    }
    this.#persisting = false;
  }
  get dirty(): boolean {
    return this.#revision !== this.#savedRevision;
  }
  #cancelTimer() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
  changed(schema: Schema) {
    if (this.#disposed) return;
    this.#schema = schema;
    this.#revision++;
    this.#persistSnapshot();
    if (this.status !== "conflict" && this.status !== "saving") this.status = "dirty";
    this.#cancelTimer();
    if (!this.#paused && this.status !== "conflict")
      this.#timer = setTimeout(() => {
        void this.flush();
      }, 1000);
  }
  async flush(): Promise<void> {
    this.#cancelTimer();
    if (this.#flight) return this.#flight;
    if (this.#disposed || this.#paused || !this.dirty || this.status === "conflict") return;
    this.#flight = this.#save();
    try {
      await this.#flight;
    } finally {
      this.#flight = null;
    }
  }
  async #save() {
    while (this.dirty && !this.#paused && !this.#disposed) {
      const snapshot = this.#schema,
        revision = this.#revision;
      this.status = "saving";
      this.error = "";
      try {
        const etag = await saveDocument(snapshot, this.etag, this.#controller.signal);
        this.etag = etag;
        if (this.#disposed) return;
        this.#savedRevision = revision;
        this.status = this.dirty ? "dirty" : "saved";
        if (!this.dirty) this.#persist(null);
        else this.#persistSnapshot();
      } catch (error) {
        if (this.#disposed) return;
        this.status = error instanceof SaveConflict ? "conflict" : "failed";
        this.error = error instanceof Error ? error.message : "Unable to save document";
        this.#cancelTimer();
        return;
      }
    }
  }
  async reload(): Promise<LoadedDocument> {
    this.#paused = true;
    this.#cancelTimer();
    await this.#flight;
    try {
      const loaded = await loadDocument(this.#controller.signal);
      this.#schema = loaded.schema;
      this.etag = loaded.etag;
      this.#revision = this.#savedRevision = 0;
      this.status = "saved";
      this.error = "";
      this.#persist(null);
      return loaded;
    } finally {
      this.#paused = false;
    }
  }
  async overwrite() {
    this.#paused = true;
    this.#cancelTimer();
    await this.#flight;
    try {
      this.etag = await loadDocumentETag(this.#controller.signal);
      this.status = "dirty";
      this.error = "";
    } catch (error) {
      this.error = String(error);
      return;
    } finally {
      this.#paused = false;
    }
    await this.flush();
  }
  dispose() {
    this.#disposed = true;
    this.#controller.abort();
    this.#cancelTimer();
  }
}
