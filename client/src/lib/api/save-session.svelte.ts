import type { Schema } from "../../schema.js";
import { loadDocument, type LoadedDocument } from "./document.js";
import { SaveConflict, saveDocument } from "./save.js";
import type { RecoveryStorage } from "./recovery.js";

export class SaveSession {
  status = $state<"saved" | "dirty" | "saving" | "failed" | "conflict">("saved");
  error = $state("");
  recoveryError = $state("");
  etag = $state<string | null>(null);
  #schema: Schema;
  #base: Schema;
  #revision = 0;
  #savedRevision = 0;
  #flight: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  #recoveryStarted = 0;
  #paused = false;
  #disposed = false;
  constructor(
    loaded: LoadedDocument,
    private recovery: RecoveryStorage,
  ) {
    this.#schema = this.#base = loaded.schema;
    this.etag = loaded.etag;
  }
  get dirty(): boolean {
    return this.#revision !== this.#savedRevision;
  }
  #cancelTimer() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
  #persist() {
    this.#cancelRecovery();
    void this.recovery
      .write({ schema: this.#schema, base: this.#base, savedAt: Date.now() })
      .catch((error) => {
        this.recoveryError =
          error instanceof Error ? error.message : "Unable to store recovery snapshot";
      });
  }
  #cancelRecovery() {
    if (this.#recoveryTimer !== null) clearTimeout(this.#recoveryTimer);
    this.#recoveryTimer = null;
  }
  #scheduleRecovery() {
    if (this.#recoveryTimer === null) this.#recoveryStarted = Date.now();
    else clearTimeout(this.#recoveryTimer);
    // Keep large structured clones out of each key event. Continuous typing
    // still produces a recovery snapshot at least once a second.
    this.#recoveryTimer = setTimeout(() => this.#persist(),
      Math.max(0, Math.min(200, 1000 - (Date.now() - this.#recoveryStarted))));
  }
  changed(schema: Schema) {
    if (this.#disposed) return;
    this.#schema = schema;
    this.#revision++;
    this.#scheduleRecovery();
    if (this.status !== "conflict" && this.status !== "saving") this.status = "dirty";
    this.#cancelTimer();
    if (!this.#paused && this.status !== "conflict")
      this.#timer = setTimeout(() => {
        void this.flush();
      }, 1000);
  }
  flushRecovery(): void {
    if (this.#recoveryTimer !== null) this.#persist();
  }
  async flush(): Promise<void> {
    this.#cancelTimer();
    this.flushRecovery();
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
        const etag = await saveDocument(snapshot, this.etag);
        this.etag = etag;
        if (this.#disposed) return;
        this.#savedRevision = revision;
        this.#base = snapshot;
        if (this.dirty) this.#persist();
        else {
          this.#cancelRecovery();
          // Queue clear immediately, before any subsequent change queues its write.
          void this.recovery.clear().catch((error) => {
            this.recoveryError = String(error);
          });
        }
        this.status = this.dirty ? "dirty" : "saved";
      } catch (error) {
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
      const loaded = await loadDocument();
      this.#schema = this.#base = loaded.schema;
      this.#cancelRecovery();
      this.etag = loaded.etag;
      this.#revision = this.#savedRevision = 0;
      this.status = "saved";
      this.error = "";
      await this.recovery.clear().catch((error) => {
        this.recoveryError = String(error);
      });
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
      this.etag = (await loadDocument()).etag;
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
    this.flushRecovery();
    this.#disposed = true;
    this.#cancelTimer();
  }
}
