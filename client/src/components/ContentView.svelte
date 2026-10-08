<script lang="ts">
  import { getContext } from "svelte";
  import { css } from "../../../styled-system/css";
  import type { Content } from "../schema.js";
  import { CONTENT_HOST, type ContentHost } from "../lib/editor/content-host.js";
  import EditorLine from "../lib/editor/EditorLine.svelte";
  import { domLineMeasurer } from "../lib/editor/line-measurer.js";
  import { visualCaret } from "../lib/editor/visual-navigation.js";
  import ContentEditor from "./ContentEditor.svelte";
  let { content, label, side }: { content: Content; label: string; side: "left" | "right" } = $props();
  const host = getContext<ContentHost>(CONTENT_HOST);
  const editing = $derived(host.focused === content.id && !host.disabled);
  let initialMeasurements = $state.raw<{ width: number; heights: number[] }>();
  function capture(root: HTMLElement) {
    if (root.querySelector('[data-testid="editor-surface"]')) return;
    initialMeasurements = { width: root.clientWidth, heights: [...root.querySelectorAll<HTMLElement>("[data-line]")].map(line => line.getBoundingClientRect().height) };
  }
  function blur(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) host.blur(content.id);
  }
  function mousedown(event: MouseEvent) {
    if (editing || host.disabled || event.button !== 0) return;
    const root = event.currentTarget as HTMLElement;
    const lines = [...root.querySelectorAll<HTMLElement>("[data-line]")];
    const element = lines.find(line => event.clientY < line.getBoundingClientRect().bottom) ?? lines.at(-1);
    if (!element) return;
    const line = Number(element.dataset.line);
    const box = element.getBoundingClientRect();
    const measure = domLineMeasurer(at => lines.find(line => Number(line.dataset.line) === at) ?? null);
    const caret = visualCaret(line, event.clientX - box.left - 12, event.clientY - box.top, measure);
    event.preventDefault();
    capture(root);
    host.focus(content.id, { kind: "caret", ...caret });
  }
</script>
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="content" data-content-id={content.id} tabindex="0" role="group" aria-label={label} onfocus={event => { capture(event.currentTarget); host.focus(content.id); }} onfocusout={blur} onmousedown={mousedown}>
  {#if editing}
    <ContentEditor doc={host.cache.get(content.id)} entry={host.entry} {side} onBoundary={host.boundary} onCommand={host.command} {initialMeasurements} />
  {:else}
    <div class={css({ fontFamily: "mono", fontSize: "12.5px", color: "ink.black", paddingTop: "8px", paddingBottom: "8px" })}>
      {#each content.text.split("\n") as text, line}
        <EditorLine {line} {text} top={0} flow register={() => {}} />
      {/each}
    </div>
  {/if}
</div>
<style>
  .content { min-width: 0; }
  .content:focus, .content:focus-within { outline: 2px solid #6883b5; outline-offset: -2px; }
</style>
