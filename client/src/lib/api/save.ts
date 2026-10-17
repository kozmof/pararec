import { loadDocument } from "./document.js";
import { parseSchema, type Schema } from "../../schema.js";
import { boundedRequest } from "./request.js";
export class SaveConflict extends Error {
  constructor() {
    super("The file changed on disk");
  }
}
export async function saveDocument(
  schema: Schema,
  etag: string | null,
  signal?: AbortSignal,
): Promise<string> {
  return boundedRequest((requestSignal) => sendDocument(schema, etag, requestSignal), signal);
}
async function sendDocument(
  schema: Schema,
  etag: string | null,
  signal: AbortSignal,
): Promise<string> {
  async function verifiedETag(): Promise<string | null> {
    const loaded = await loadDocument(signal);
    return loaded.etag !== null &&
      JSON.stringify(loaded.schema) === JSON.stringify(parseSchema(schema))
      ? loaded.etag
      : null;
  }
  let response: Response;
  try {
    response = await fetch("/api/document", {
      method: "PUT",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(etag === null ? { "If-None-Match": "*" } : { "If-Match": etag }),
      },
      body: JSON.stringify(schema),
    });
  } catch (cause) {
    // A transport failure can happen after the server has committed the snapshot.
    if (!signal?.aborted) {
      try {
        const verified = await verifiedETag();
        if (verified) return verified;
      } catch {}
    }
    throw cause;
  }
  if (response.status === 412) {
    // Recover a previous write whose response timed out before verification.
    try {
      const verified = await verifiedETag();
      if (verified) return verified;
    } catch {}
    throw new SaveConflict();
  }
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    const code =
      detail && typeof detail === "object" && "error" in detail && typeof detail.error === "string"
        ? detail.error
        : null;
    if (code === "SaveOutcomeUncertain") {
      const verified = await verifiedETag();
      if (verified) return verified;
      throw new SaveConflict();
    }
    throw new Error(`Unable to save document (${response.status}${code ? `: ${code}` : ""})`);
  }
  const next = response.headers.get("ETag");
  if (!next) throw new Error("Save response is missing its ETag");
  return next;
}
