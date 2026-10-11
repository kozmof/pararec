import { loadDocument } from "./document.js";
import type { Schema } from "../../schema.js";
export class SaveConflict extends Error {
  constructor() {
    super("The file changed on disk");
  }
}
export async function saveDocument(schema: Schema, etag: string | null): Promise<string> {
  const response = await fetch("/api/document", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(etag === null ? { "If-None-Match": "*" } : { "If-Match": etag }),
    },
    body: JSON.stringify(schema),
  });
  if (response.status === 412) throw new SaveConflict();
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    const code = detail && typeof detail === "object" && "error" in detail
      && typeof detail.error === "string" ? detail.error : null;
    if (code === "SaveOutcomeUncertain") {
      const loaded = await loadDocument();
      if (loaded.etag !== null && JSON.stringify(loaded.schema) === JSON.stringify(schema))
        return loaded.etag;
      throw new SaveConflict();
    }
    throw new Error(`Unable to save document (${response.status}${code ? `: ${code}` : ""})`);
  }
  const next = response.headers.get("ETag");
  if (!next) throw new Error("Save response is missing its ETag");
  return next;
}
