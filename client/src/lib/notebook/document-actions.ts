import type { ContentCache, ContentChange } from "../editor/content-cache.js";
import type { Caret } from "../editor/document-store.svelte.js";
import type { AppHistory, AppSnapshot, FocusSnapshot } from "../history/history.svelte.js";
import type { Op } from "../tree/ops.js";
import type { TreeStore } from "../tree/tree-store.svelte.js";

type ActionContext = {
  tree(): TreeStore | null;
  cache(): ContentCache | undefined;
  history: AppHistory;
  snapshot(focus?: FocusSnapshot | null): AppSnapshot;
  changed(): void;
};

/** Keep mutation, history grouping, and save notification in one action boundary. */
export class DocumentActions {
  constructor(private context: ActionContext) {}
  apply(
    ops: Op[],
    options: {
      sourceId?: string;
      beforeFocus?: FocusSnapshot | null;
      afterApply?: () => void;
      afterFocus?: () => FocusSnapshot | null;
    } = {},
  ) {
    const { history } = this.context;
    const tree = this.context.tree();
    if (!tree || !ops.length) return;
    history.closeGroup();
    if (options.sourceId) this.context.cache()?.get(options.sourceId).closeHistoryGroup();
    const before = this.context.snapshot(options.beforeFocus);
    if (ops.length === 1) tree.apply(ops[0]);
    else tree.applyMany(ops);
    options.afterApply?.();
    history.record(
      before,
      this.context.snapshot(options.afterFocus ? options.afterFocus() : undefined),
    );
    this.context.changed();
  }
  recordEdit(edit: ContentChange, path: string[], caret: Caret | null): Caret {
    const beforeCaret = edit.beforeCaret ?? caret ?? { line: 0, column: 0 };
    const afterCaret = edit.afterCaret ?? beforeCaret;
    this.context.history.record(
      {
        schema: edit.before,
        path: [...path],
        focus: { contentId: edit.contentId, ...beforeCaret },
      },
      { schema: edit.after, path: [...path], focus: { contentId: edit.contentId, ...afterCaret } },
      edit.kind === "edit" && edit.groupable && edit.intent && edit.intent !== "replace"
        ? { contentId: edit.contentId, intent: edit.intent, group: edit.group }
        : undefined,
      edit.textChange,
      edit.textPatch,
    );
    return { ...afterCaret };
  }
  restore(target: AppSnapshot) {
    const tree = this.context.tree();
    if (!tree) return;
    const previous = target.textChange ? tree.index.get(target.textChange.contentId) : undefined;
    const previousText =
      previous && previous.side !== "container"
        ? previous.side === "right"
          ? previous.container.right.text
          : previous.container.left[previous.index].text
        : undefined;
    tree.restore(target.schema);
    this.context.cache()?.restoreText(target.textChange, previousText);
  }
}
