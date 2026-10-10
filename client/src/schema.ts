export type Content = {
  id: string;
  text: string;
};

export type Container = {
  id: string;
  left: Content[];
  right: Content & { children: Container[] };
};

export type Config = {
  showTitles: boolean;
  maxWidth: number;
  outerWidthRate: { left: number; right: number };
  innerIdthRate: { left: number; right: number };
};

export type Schema = {
  title: string;
  config: Config;
  version: 1;
  root: Container[];
};

/** Parse the file format, discard unknown fields, and normalize loaded text. */
export function parseSchema(value: unknown, defaultTitle = "document"): Schema {
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
  let title = defaultTitle;
  const config: Config = {
    showTitles: true,
    maxWidth: 1100,
    outerWidthRate: { left: 35, right: 65 },
    innerIdthRate: { left: 35, right: 65 },
  };
  const settings = document.config === undefined ? {} : object(document.config);
  if (settings.maxWidth !== undefined) {
    if (typeof settings.maxWidth !== "number" || !Number.isFinite(settings.maxWidth) || settings.maxWidth <= 0) throw new Error("Expected positive finite maxWidth in pixels");
    config.maxWidth = settings.maxWidth;
  }
  if (document.title !== undefined) {
    if (typeof document.title !== "string") throw new Error("Expected string title");
    title = document.title.replace(/\r\n?/g, "\n");
  }
  if (settings.showTitles !== undefined) {
    if (typeof settings.showTitles !== "boolean") throw new Error("Expected boolean showTitles");
    config.showTitles = settings.showTitles;
  }
  for (const key of ["outerWidthRate", "innerIdthRate"] as const) {
    if (settings[key] === undefined) continue;
    const rate = object(settings[key]);
    if (
      typeof rate.left !== "number" ||
      typeof rate.right !== "number" ||
      !Number.isFinite(rate.left) ||
      !Number.isFinite(rate.right) ||
      rate.left <= 0 ||
      rate.right <= 0
    )
      throw new Error("Expected positive finite width rates");
    config[key] = { left: rate.left, right: rate.right };
  }
  return { version: 1, title, config, root: level(document.root) };
}
