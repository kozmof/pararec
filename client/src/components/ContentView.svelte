<script lang="ts">
  import { getContext, untrack, type Snippet } from "svelte";
  import type { Content } from "../schema.js";
  import { CONTENT_HOST, type ContentHost } from "../lib/editor/content-host.js";
  import { domLineMeasurer } from "../lib/editor/line-measurer.js";
  import { visualCaret } from "../lib/editor/visual-navigation.js";
  import ContentEditor from "./ContentEditor.svelte";
  let { content, label, side, navigation }: { content: Content; label: string; side: "left" | "right"; navigation?: Snippet } = $props();
  let editor = $state<ContentEditor>();
  const host = getContext<ContentHost>(CONTENT_HOST);
  const editing = $derived(host.focused === content.id && !host.disabled);
  const text = $derived(content.text);
  const doc = $derived.by(() => {
    void text;
    void editing;
    return untrack(() => host.cache.get(content.id));
  });
  function blur(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) host.blur(content.id);
  }
  function mousedown(event: MouseEvent) {
    if (host.disabled || event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    if (editing) {
      if (!event.defaultPrevented) editor?.focusAt(event);
      return;
    }
    const root = event.currentTarget as HTMLElement;
    const targetLine = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-line]") : null;
    let element = targetLine && root.contains(targetLine) ? targetLine : undefined;
    if (!element) {
      const lines = root.querySelectorAll<HTMLElement>("[data-line]");
      let low = 0;
      let high = lines.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (event.clientY < lines[middle]!.getBoundingClientRect().bottom) high = middle;
        else low = middle + 1;
      }
      element = lines[low] ?? lines[lines.length - 1];
    }
    if (!element) return;
    const line = Number(element.dataset.line);
    const box = element.getBoundingClientRect();
    const measure = domLineMeasurer(at => at === line ? element! : root.querySelector<HTMLElement>(`[data-line="${at}"]`));
    const caret = visualCaret(line, event.clientX - box.left - 12, event.clientY - box.top, measure);
    event.preventDefault();
    host.focus(content.id, { kind: "caret", ...caret });
  }
</script>
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="content" data-content-id={content.id} tabindex="0" role="group" aria-label={label} onfocus={event => { host.focus(content.id); if (event.target === event.currentTarget && editing) editor?.focus(); }} onfocusout={blur} onmousedown={mousedown}>
  <ContentEditor bind:this={editor} {doc} active={editing} entry={host.entry} {side} onBoundary={host.boundary} onCommand={host.command} onCaret={caret => { if (editing) host.caret(content.id, caret); }} />
  {@render navigation?.()}
</div>
<style>
  .content { position: relative; min-width: 0; display: flex; flex-direction: column; outline: none; }
  .content:last-child { flex: 1; }
</style>
