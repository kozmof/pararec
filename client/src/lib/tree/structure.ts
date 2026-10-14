import { MAX_CONTAINER_DEPTH, type Schema } from "../../schema.js";
import type { Caret } from "../editor/document-store.svelte.js";
import type { Entry } from "../editor/content-host.js";
import { GraphemeCache } from "../editor/graphemes.js";
import { buildIndex, type TreeIndex } from "./index.js";
import { applyOp, createContainer, type Op } from "./ops.js";
import { containerPath } from "./navigation.js";

export type StructureCommand =
  | "split"
  | "newSibling"
  | "newChild"
  | "removeRow"
  | "removeLeft"
  | "removeChildren"
  | "join"
  | "deleteContainer"
  | "moveUp"
  | "moveDown";
export type StructureAction = {
  ops: Op[];
  focus: { contentId: string; entry: Entry } | null;
  path: string[];
};
function caretEntry(text: string, caret: Caret): Extract<Entry, { kind: "caret" }> {
  const lines = text.split("\n");
  const line = Math.max(0, Math.min(lines.length - 1, caret.line));
  const column = new GraphemeCache().snap(line, lines[line], caret.column);
  return {
    kind: "caret",
    line,
    column,
    ...(caret.affinity && line === caret.line && column === caret.column
      ? { affinity: caret.affinity }
      : {}),
  };
}
function end(text: string): Entry {
  const lines = text.split("\n");
  return { kind: "caret", line: lines.length - 1, column: lines.at(-1)!.length };
}

/** Describe one structure action without publishing intermediate trees or changing text stores. */
function planStructureAction(
  schema: Schema,
  index: TreeIndex,
  path: string[],
  contentId: string,
  caret: Caret,
  command: StructureCommand,
): StructureAction | null {
  const current = index.get(contentId);
  if (!current || current.side === "container") return null;
  const container = current.container;
  const containerEntry = index.get(container.id)!;
  const siblings =
    current.parentId === null ? schema.root : index.get(current.parentId)!.container.right.children;
  const text = current.side === "left" ? container.left[current.index].text : container.right.text;
  const entry = caretEntry(text, caret);
  const focus = { contentId, entry };
  const lines = text.split("\n");
  const offset =
    lines.slice(0, entry.line).reduce((length, line) => length + line.length + 1, 0) + entry.column;
  switch (command) {
    case "split": {
      if (current.side !== "left") return null;
      const content = { id: crypto.randomUUID(), text: text.slice(offset) };
      return {
        path,
        ops: [
          { type: "setText", id: contentId, text: text.slice(0, offset) },
          { type: "insertContent", containerId: container.id, index: current.index + 1, content },
        ],
        focus: { contentId: content.id, entry: { kind: "edge", edge: "start" } },
      };
    }
    case "newSibling": {
      const sibling = createContainer(current.side === "left" ? text.slice(offset) : "", current.side === "right" ? text.slice(offset) : "");
      const destination = current.side === "left" ? sibling.left[0] : sibling.right;
      return {
        path,
        ops: [
          { type: "setText", id: contentId, text: text.slice(0, offset) },
          {
            type: "insertContainer",
            parentId: current.parentId,
            index: containerEntry.index + 1,
            container: sibling,
          },
        ],
        focus: { contentId: destination.id, entry: { kind: "edge", edge: "start" } },
      };
    }
    case "newChild": {
      if (current.side !== "right") return null;
      if (containerPath(index, container.id).length >= MAX_CONTAINER_DEPTH) return null;
      const child = createContainer();
      return {
        path:
          current.parentId === (path.at(-1) ?? null) ? path : containerPath(index, container.id),
        ops: [
          {
            type: "insertContainer",
            parentId: container.id,
            index: container.right.children.length,
            container: child,
          },
        ],
        focus: { contentId: child.right.id, entry: { kind: "edge", edge: "start" } },
      };
    }
    case "removeLeft": {
      if (current.side !== "left" || container.left.length === 1) return null;
      const destination = container.left[current.index + 1] ?? container.left[current.index - 1];
      return {
        path,
        ops: [{ type: "removeContent", id: contentId }],
        focus: { contentId: destination.id, entry: { kind: "edge", edge: "start" } },
      };
    }
    case "removeChildren": {
      if (current.side !== "right" || !container.right.children.length) return null;
      return {
        path,
        ops: container.right.children.map(child => ({ type: "removeContainer", id: child.id, expected: child })),
        focus,
      };
    }
    case "removeRow": {
      const neighbour = siblings[containerEntry.index + 1] ?? siblings[containerEntry.index - 1];
      const destination = neighbour
        ? current.side === "left" ? neighbour.left[0].id : neighbour.right.id
        : current.parentId !== null ? index.get(current.parentId)!.container.right.id : null;
      const nextPath = path.includes(container.id) ? path.slice(0, path.indexOf(container.id)) : path;
      return {
        path: nextPath,
        ops: [{ type: "removeContainer", id: container.id, expected: container }],
        focus: destination ? { contentId: destination, entry: { kind: "edge", edge: "start" } } : null,
      };
    }
    case "join": {
      if (current.side !== "left" || offset !== 0 || current.index === 0) return null;
      const previous = container.left[current.index - 1];
      return {
        path,
        ops: [
          { type: "setText", id: previous.id, text: `${previous.text}\n${text}` },
          { type: "removeContent", id: contentId },
        ],
        focus: { contentId: previous.id, entry: end(previous.text) },
      };
    }
    case "deleteContainer": {
      if (
        current.side !== "right" ||
        text ||
        container.left.some((content) => content.text) ||
        container.right.children.length
      )
        return null;
      const next = siblings[containerEntry.index + 1],
        previous = siblings[containerEntry.index - 1];
      let destination: StructureAction["focus"] = next
        ? { contentId: next.right.id, entry: { kind: "edge", edge: "start" } }
        : previous
          ? { contentId: previous.right.id, entry: end(previous.right.text) }
          : null;
      if (!destination && current.parentId !== null && current.parentId !== (path.at(-1) ?? null))
        destination = {
          contentId: index.get(current.parentId)!.container.right.id,
          entry: { kind: "edge", edge: "start" },
        };
      return { path, ops: [{ type: "removeContainer", id: container.id }], focus: destination };
    }
    case "moveUp":
    case "moveDown": {
      const direction = command === "moveUp" ? -1 : 1;
      if (current.side === "right") {
        const position = containerEntry.index + direction;
        if (position < 0 || position >= siblings.length) return null;
        return {
          path,
          focus,
          ops: [
            {
              type: "moveContainer",
              id: container.id,
              parentId: current.parentId,
              index: position,
            },
          ],
        };
      }
      const position = current.index + direction;
      if (position >= 0 && position < container.left.length)
        return {
          path,
          focus,
          ops: [{ type: "moveContent", id: contentId, containerId: container.id, index: position }],
        };
      const neighbour = siblings[containerEntry.index + direction];
      if (!neighbour || container.left.length === 1) return null;
      return {
        path,
        focus,
        ops: [
          {
            type: "moveContent",
            id: contentId,
            containerId: neighbour.id,
            index: direction < 0 ? neighbour.left.length : 0,
          },
        ],
      };
    }
  }
}

/** Transform labels with their text and remove references to deleted cells. */
export function structureAction(
  schema: Schema, index: TreeIndex, path: string[], contentId: string,
  caret: Caret, command: StructureCommand,
): StructureAction | null {
  const action = planStructureAction(schema, index, path, contentId, caret, command);
  if (!action || !schema.links?.length) return action;
  let staged = schema;
  for (const op of action.ops) staged = applyOp(staged, op, buildIndex(staged), false).schema;
  const nextIndex = buildIndex(staged);
  let links = [...schema.links];
  if (command === "split" || command === "newSibling") {
    const source = nextIndex.get(contentId)!;
    const text = source.side === "left" ? source.container.left[source.index].text : source.container.right.text;
    const split = new TextEncoder().encode(text).length;
    const destination = action.focus!.contentId;
    links = links.flatMap(link => {
      if (link.sourceId !== contentId || link.end <= split) return [link];
      if (link.start >= split) return [{ ...link, sourceId: destination, start: link.start - split, end: link.end - split }];
      // A crossing label becomes one label in each cell with the same destinations.
      return [{ ...link, end: split }, { ...link, id: crypto.randomUUID(), sourceId: destination, start: 0, end: link.end - split }];
    });
  } else if (command === "join") {
    const destination = action.focus!.contentId;
    const previous = index.get(destination)!;
    const shift = new TextEncoder().encode(previous.container.left[previous.index].text + "\n").length;
    links = links.map(link => ({ ...link,
      ...(link.sourceId === contentId ? { sourceId: destination, start: link.start + shift, end: link.end + shift } : {}),
      targets: [...new Set(link.targets.map(id => id === contentId ? destination : id))],
    }));
  }
  links = links.flatMap(link => {
    if (!nextIndex.has(link.sourceId)) return [];
    const targets = link.targets.filter(id => id !== link.sourceId && nextIndex.has(id));
    return targets.length ? [{ ...link, targets }] : [];
  });
  action.ops.push({ type: "setLinks", links });
  return action;
}
