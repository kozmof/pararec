export const MAX_CONTAINER_DEPTH = 64;

export type Content = {
  readonly id: string;
  readonly text: string;
};

export type Container = {
  readonly id: string;
  readonly left: readonly Content[];
  readonly right: Content & { readonly children: readonly Container[] };
};

export type Config = {
  readonly showTitles: boolean;
  readonly maxWidth: number;
  readonly outerWidthRate: { readonly left: number; readonly right: number };
  readonly innerWidthRate: { readonly left: number; readonly right: number };
};

export type TextLink = { readonly id: string; readonly sourceId: string; readonly start: number; readonly end: number; readonly targets: readonly string[] };

export type Schema = {
  readonly links?: readonly TextLink[];
  readonly title: string;
  readonly config: Config;
  readonly version: 1;
  readonly root: readonly Container[];
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
  function level(input: unknown, depth = 1): Container[] {
    if (!Array.isArray(input)) throw new Error("Expected a Container array");
    if (input.length && depth > MAX_CONTAINER_DEPTH) throw new Error("Maximum container depth exceeded");
    return input.map((input) => {
      const row = object(input);
      const containerId = id(row.id);
      if (!Array.isArray(row.left) || row.left.length === 0) throw new Error("Empty left cell");
      const left = row.left.map(content);
      const right = content(row.right);
      const children = level(object(row.right).children, depth + 1);
      return { id: containerId, left, right: { ...right, children } };
    });
  }
  const document = object(value);
  if (document.version !== 1) throw new Error("Unsupported version");
  let title = defaultTitle;
  const config: { -readonly [K in keyof Config]: Config[K] } = {
    showTitles: true,
    maxWidth: 1100,
    outerWidthRate: { left: 35, right: 65 },
    innerWidthRate: { left: 35, right: 65 },
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
  for (const key of ["outerWidthRate", "innerWidthRate"] as const) {
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
  const root = level(document.root);
  const links = document.links ?? [];
  if (!Array.isArray(links)) throw new Error("Expected links array");
  const parsedLinks = links.map(input => {
    const link = object(input);
    if (typeof link.id !== "string" || typeof link.sourceId !== "string" || !Number.isSafeInteger(link.start) || !Number.isSafeInteger(link.end) || (link.start as number) < 0 || (link.end as number) <= (link.start as number) || !Array.isArray(link.targets) || !link.targets.every(target => typeof target === "string")) throw new Error("Invalid text link");
    return { id: link.id, sourceId: link.sourceId, start: link.start as number, end: link.end as number, targets: link.targets as string[] };
  });
  return { version: 1, title, config, root, ...(parsedLinks.length ? { links: parsedLinks } : {}) };
}
