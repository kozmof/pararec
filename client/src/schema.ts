export const MAX_CONTAINER_DEPTH = 64;
export const MAX_JSON_DEPTH = 256;

// Match the server's JSON scanner, including fields discarded during normalization.
function validateJSONDepth(value: unknown, depth = 0): void {
  if (value === null || typeof value !== "object") return;
  if (depth >= MAX_JSON_DEPTH) throw new Error("Maximum JSON depth exceeded");
  for (const key in value) {
    if (Object.hasOwn(value, key))
      validateJSONDepth((value as Record<string, unknown>)[key], depth + 1);
  }
}

export type RenderType = string;
export const DEFAULT_RENDER_TYPES = ["none", "markdown", "katex"] as const;

export function validateRenderTypes(value: unknown): asserts value is readonly RenderType[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Expected nonempty renderTypes array");
  value.forEach((type) => validateRenderType(type));
  if (new Set(value).size !== value.length) throw new Error("Duplicate render type");
}

export function validateRenderType(
  value: unknown,
  allowed?: readonly RenderType[],
): asserts value is RenderType {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty render type");
  if (allowed && !allowed.includes(value))
    throw new Error("Render type is not in config.renderTypes");
}

export type Content = {
  readonly renderType?: RenderType;
  readonly id: string;
  readonly text: string;
};

export type Container = {
  readonly id: string;
  readonly left: readonly Content[];
  readonly right: Content & { readonly children: readonly Container[] };
};

export type Config = {
  readonly renderType: RenderType;
  readonly renderTypes: readonly RenderType[];
  readonly showTitles: boolean;
  readonly maxWidth: number;
  readonly outerWidthRate: { readonly left: number; readonly right: number };
  readonly innerWidthRate: { readonly left: number; readonly right: number };
};

export type TextLink = {
  readonly id: string;
  readonly sourceId: string;
  readonly start: number;
  readonly end: number;
  readonly targets: readonly string[];
};

export type Schema = {
  readonly links?: readonly TextLink[];
  readonly title: string;
  readonly config: Config;
  readonly version: 1;
  readonly root: readonly Container[];
};

/** Parse the file format, discard unknown fields, and normalize loaded text. */
export function parseSchema(value: unknown, defaultTitle = "document"): Schema {
  validateJSONDepth(value);
  const ids = new Set<string>();
  const originalTexts = new Map<string, string>();
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
    const contentId = id(note.id);
    if (note.text.includes("\r")) originalTexts.set(contentId, note.text);
    if (note.renderType != null) validateRenderType(note.renderType, config.renderTypes);
    return {
      ...(note.renderType != null ? { renderType: note.renderType } : {}),
      id: contentId,
      text: note.text.replace(/\r\n?/g, "\n"),
    };
  }
  function level(input: unknown, depth = 1): Container[] {
    if (!Array.isArray(input)) throw new Error("Expected a Container array");
    if (input.length && depth > MAX_CONTAINER_DEPTH)
      throw new Error("Maximum container depth exceeded");
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
    renderType: "none",
    renderTypes: [...DEFAULT_RENDER_TYPES],
    showTitles: true,
    maxWidth: 1100,
    outerWidthRate: { left: 35, right: 65 },
    innerWidthRate: { left: 35, right: 65 },
  };
  const settings = document.config === undefined ? {} : object(document.config);
  if (settings.renderTypes !== undefined) {
    validateRenderTypes(settings.renderTypes);
    config.renderTypes = [...settings.renderTypes];
  }
  if (settings.renderType !== undefined) {
    validateRenderType(settings.renderType);
    config.renderType = settings.renderType;
  }
  validateRenderType(config.renderType, config.renderTypes);
  if (settings.maxWidth !== undefined) {
    if (
      typeof settings.maxWidth !== "number" ||
      !Number.isFinite(settings.maxWidth) ||
      settings.maxWidth <= 0
    )
      throw new Error("Expected positive finite maxWidth in pixels");
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
  const links = document.links === undefined ? [] : document.links;
  if (!Array.isArray(links)) throw new Error("Expected links array");
  const parsedLinks = links.map((input) => {
    const link = object(input);
    if (
      typeof link.id !== "string" ||
      typeof link.sourceId !== "string" ||
      !Number.isSafeInteger(link.start) ||
      !Number.isSafeInteger(link.end) ||
      (link.start as number) < 0 ||
      (link.end as number) <= (link.start as number) ||
      !Array.isArray(link.targets) ||
      !link.targets.every((target) => typeof target === "string")
    )
      throw new Error("Invalid text link");
    let start = link.start as number,
      end = link.end as number;
    const original = originalTexts.get(link.sourceId);
    if (original !== undefined && original.includes("\r")) {
      const bytes = new TextEncoder().encode(original);
      if (
        end > bytes.length ||
        (bytes[start] & 0xc0) === 0x80 ||
        (end < bytes.length && (bytes[end] & 0xc0) === 0x80)
      )
        throw new Error("Invalid link byte range");
      const offset = (end: number) => {
        let removed = 0;
        for (let i = 0; i < end; i++) if (bytes[i] === 13 && bytes[i + 1] === 10) removed++;
        return end - removed;
      };
      start = offset(start);
      end = offset(end);
    }
    return { id: link.id, sourceId: link.sourceId, start, end, targets: link.targets as string[] };
  });
  const schema: Schema = {
    version: 1,
    title,
    config,
    root,
    ...(parsedLinks.length ? { links: parsedLinks } : {}),
  };
  validateLinks(schema);
  return schema;
}

/** Link coordinates are UTF-8 byte offsets into normalized source text. */
export function validateLinks(
  schema: Schema,
  contentText?: (id: string) => string | undefined,
): void {
  if (!schema.links?.length) return;
  const texts = new Map<string, string>();
  function visit(rows: readonly Container[]) {
    for (const row of rows) {
      for (const cell of [...row.left, row.right]) texts.set(cell.id, cell.text);
      visit(row.right.children);
    }
  }
  if (!contentText) visit(schema.root);
  const getText = contentText ?? ((id: string) => texts.get(id));
  const ids = new Set<string>();
  const encoded = new Map<string, Uint8Array>();
  for (const link of schema.links) {
    if (typeof link.id !== "string" || ids.has(link.id))
      throw new Error("Duplicate or invalid link id");
    ids.add(link.id);
    const text = getText(link.sourceId);
    if (text === undefined) throw new Error("Unknown link source");
    let bytes = encoded.get(link.sourceId);
    if (!bytes) {
      bytes = new TextEncoder().encode(text);
      encoded.set(link.sourceId, bytes);
    }
    const boundary = (offset: number) => offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80;
    if (
      !Number.isSafeInteger(link.start) ||
      !Number.isSafeInteger(link.end) ||
      link.start < 0 ||
      link.end <= link.start ||
      link.end > bytes.length ||
      !boundary(link.start) ||
      !boundary(link.end)
    )
      throw new Error("Invalid link byte range");
    if (
      !Array.isArray(link.targets) ||
      !link.targets.length ||
      new Set(link.targets).size !== link.targets.length ||
      link.targets.some((id) => id === link.sourceId || getText(id) === undefined)
    )
      throw new Error("Invalid link targets");
  }
}
