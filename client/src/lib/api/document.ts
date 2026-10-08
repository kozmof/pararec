import { parseSchema, type Schema } from "../../schema.js";
export type LoadedDocument = { schema: Schema; etag: string | null };
export async function loadDocument(signal?: AbortSignal): Promise<LoadedDocument> {
  const response = await fetch("/api/document", { signal, cache: "no-store" });
  if (response.status === 404) return { schema: { version: 1, root: [] }, etag: null };
  if (!response.ok) throw new Error(`Unable to load document (${response.status})`);
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Document response is missing its ETag");
  return { schema: parseSchema(await response.json()), etag };
}
