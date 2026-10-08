export type Content = {
  id: string;
  text: string;
};

export type Container = {
  id: string;
  left: Content[];
  right: Content & { children: Container[] };
};

export type Schema = {
  version: 1;
  root: Container[];
};

/** Parse the file format, discard unknown fields, and normalize loaded text. */
export function parseSchema(value: unknown): Schema {
  const ids = new Set<string>();
  function object(input: unknown): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Expected an object");
    }
    return input as Record<string, unknown>;
  }
  function id(input: unknown): string {
    if (typeof input !== "string") throw new Error("Expected a string id");
    if (ids.has(input)) throw new Error("Duplicate id");
    ids.add(input);
    return input;
  }
  function content(input: unknown): Content {
    const note = object(input);
    if (typeof note.text !== "string") throw new Error("Expected string text");
    return { id: id(note.id), text: note.text.replace(/\r\n?/g, "\n") };
  }
  function level(input: unknown): Container[] {
    if (!Array.isArray(input)) throw new Error("Expected a Container array");
    return input.map((input) => {
      const row = object(input);
      const containerId = id(row.id);
      if (!Array.isArray(row.left) || row.left.length === 0) throw new Error("Empty left cell");
      const left = row.left.map(content);
      const right = content(row.right);
      const children = level(object(row.right).children);
      return { id: containerId, left, right: { ...right, children } };
    });
  }
  const document = object(value);
  if (document.version !== 1) throw new Error("Unsupported version");
  return { version: 1, root: level(document.root) };
}
