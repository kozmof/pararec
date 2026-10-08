import { parseSchema, type Schema } from "../../schema.js";
export type LoadedDocument = { schema: Schema; etag: string | null };
export async function loadDocument(signal?: AbortSignal): Promise<LoadedDocument> {
  let response: Response;
  try {
    response = await fetch("/api/document", { signal, cache: "no-store" });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error("Cannot reach the local server. Start pararec serve and retry.", { cause });
  }
  if (response.status === 404) return { schema: { version: 1, root: [] }, etag: null };
  if (!response.ok) {
    if (response.status === 500)
      throw new Error(
        "The local server could not read the document. Check the file and its permissions, then retry.",
      );
    throw new Error(`Unable to load document (${response.status})`);
  }
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Document response is missing its ETag");
  try {
    return { schema: parseSchema(await response.json()), etag };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const detail =
      cause instanceof SyntaxError
        ? "Invalid JSON"
        : cause instanceof Error
          ? cause.message
          : "Invalid schema";
    throw new Error(`The document file is invalid (${detail}). Fix the file and retry.`, { cause });
  }
}
