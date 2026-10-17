import { createSubscriber } from "svelte/reactivity";
import type { TextLink } from "../../schema.js";

const emptyLinks: readonly TextLink[] = Object.freeze([]);
type Subscription = { read(): void; update(): void };

/** Subscribe to one cell's links without tracking the entire document snapshot. */
export class LinkIndex {
  #links: readonly TextLink[] | undefined;
  #groups = new Map<string, readonly TextLink[]>();
  #subscriptions = new Map<string, Subscription>();

  forSource(id: string): readonly TextLink[] {
    const subscription = this.#subscriptions.get(id);
    if (subscription) subscription.read();
    else {
      const read = createSubscriber((update) => {
        this.#subscriptions.set(id, { read, update });
        return () => {
          if (this.#subscriptions.get(id)?.read === read) this.#subscriptions.delete(id);
        };
      });
      read();
    }
    return this.#groups.get(id) ?? emptyLinks;
  }

  update(links: readonly TextLink[] | undefined): void {
    if (links === this.#links) return;
    const next = new Map<string, TextLink[]>();
    for (const link of links ?? []) {
      const group = next.get(link.sourceId);
      if (group) group.push(link);
      else next.set(link.sourceId, [link]);
    }
    const previous = this.#groups;
    const groups = new Map<string, readonly TextLink[]>();
    const changed = new Set<string>();
    for (const [id, group] of next) {
      const before = previous.get(id);
      if (before && sameLinks(before, group)) groups.set(id, before);
      else {
        groups.set(id, Object.freeze(group));
        changed.add(id);
      }
    }
    for (const id of previous.keys()) if (!groups.has(id)) changed.add(id);
    this.#groups = groups;
    this.#links = links;
    for (const id of changed) this.#subscriptions.get(id)?.update();
  }
}

function sameLinks(a: readonly TextLink[], b: readonly TextLink[]): boolean {
  return (
    a.length === b.length &&
    a.every((link, index) => {
      const next = b[index];
      return (
        link === next ||
        (link.id === next.id &&
          link.sourceId === next.sourceId &&
          link.start === next.start &&
          link.end === next.end &&
          link.targets.length === next.targets.length &&
          link.targets.every((target, at) => target === next.targets[at]))
      );
    })
  );
}
