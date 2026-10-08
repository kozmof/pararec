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
  if (!response.ok) throw new Error(`Unable to save document (${response.status})`);
  const next = response.headers.get("ETag");
  if (!next) throw new Error("Save response is missing its ETag");
  return next;
}
