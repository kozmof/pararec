<script lang="ts">
  import { getContext, untrack, type Snippet } from "svelte";
  import type { Content } from "../schema.js";
  import { CONTENT_HOST, type ContentHost } from "../lib/editor/content-host.js";
  import { domLineMeasurer } from "../lib/editor/line-measurer.js";
  import { visualCaret } from "../lib/editor/visual-navigation.js";
  import { getRenderer } from "../lib/render/renderers.js";
  import "katex/dist/katex.min.css";
  import ContentEditor from "./ContentEditor.svelte";
  let { content, label, side, navigation }: { content: Content; label: string; side: "left" | "right"; navigation?: Snippet } = $props();
  let editor = $state<ContentEditor>();
  const host = getContext<ContentHost>(CONTENT_HOST);
  const owner = {};
  const editing = $derived(host.focused === content.id && !host.disabled && !host.linking);
  const text = $derived(content.text);
  const renderType = $derived(content.renderType ?? host.renderType ?? "none");
  const renderer = $derived(getRenderer(renderType));
  const rendered = $derived(!editing && !host.linking && renderType !== "none" && renderer ? renderer(text) : null);
  let nearby = $state(typeof IntersectionObserver === "undefined");
  let measuredHeight = $state(0);
  const mounted = $derived(nearby || editing);
  function viewport(node: HTMLElement) {
    if (typeof IntersectionObserver === "undefined") return;
    const box = node.getBoundingClientRect();
    nearby = box.bottom >= -800 && box.top <= window.innerHeight + 800;
    const observer = new IntersectionObserver(entries => {
      nearby = entries[0].isIntersecting;
    }, { rootMargin: "800px" });
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }
  const doc = $derived.by(() => {
    void text;
    void editing;
    if (!mounted) return null;
    const cache = host.cache;
    const id = content.id;
    return untrack(() => cache.get(id, owner));
  });
  $effect(() => {
    const cache = host.cache;
    const id = content.id;
    const owns = mounted;
    return () => { if (owns) cache.release(id, owner); };
  });
  function previewHeight(node: HTMLElement) {
    measuredHeight = node.getBoundingClientRect().height;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { measuredHeight = node.getBoundingClientRect().height; });
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
  }
  function blur(event: FocusEvent) {
    // The cell and its context menu share the current editing session.
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest<HTMLElement>("[data-menu-source-id]")?.dataset.menuSourceId === content.id) return;
    if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) host.blur(content.id);
  }
  function mousedown(event: MouseEvent) {
    if (host.disabled || event.button !== 0) return;
    // Safari blurs the textarea without focusing buttons. Keep the editor mounted
    // until the click navigates, so clearing its selection cannot move the button.
    if (event.target instanceof Element && event.target.closest("button")) {
      event.preventDefault();
      return;
    }
    if (host.linking) { event.preventDefault(); host.selectCell?.(content.id); return; }
    if (editing) {
      if (!event.defaultPrevented) editor?.focusAt(event);
      return;
    }
    if (rendered !== null) {
      if (event.target instanceof Element && event.target.closest("a")) return;
      event.preventDefault();
      host.focus(content.id, { kind: "edge", edge: "start" });
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
    editor?.focusAt(event, true);
  }
</script>
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div use:viewport class="content" class:linking={host.linking} class:chosen={host.selectedCell?.(content.id)} onkeydown={event => { if (host.linking && !(event.target instanceof Element && event.target.closest("button")) && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); host.selectCell?.(content.id); } }} oncontextmenu={event => { event.preventDefault(); if (host.disabled || host.linking) return; host.renderMenu?.(content.id, event); const label = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-link-ids]") : null; if (label?.dataset.linkIds) { event.preventDefault(); host.labelMenu?.(content.id, label.dataset.linkIds.split(" "), event); return; } const range = editor?.selected(); if (range && range.end > range.start) { event.preventDefault(); host.linkMenu?.(content.id, range, event); } }} data-content-id={content.id} tabindex="0" role="group" aria-label={label} onfocus={event => { if (event.target instanceof Element && event.target.closest("[data-editor-annotation], a")) return; host.focus(content.id); if (event.target === event.currentTarget && editing) editor?.focus(); }} onfocusout={blur} onmousedown={mousedown}>
  {#if doc && rendered !== null}
    <div use:previewHeight class="rendered" data-render-type={renderType}>{@html rendered}</div>
  {:else if doc}
  <ContentEditor onHeight={height => { measuredHeight = height; }} links={(host.links ?? []).filter(link => link.sourceId === content.id)} onDestination={host.followLink} annotationsDisabled={host.linking || host.disabled} bind:this={editor} {doc} active={editing} entry={host.entry} {side} onBoundary={host.boundary} onCommand={host.command} onCaret={caret => { if (editing) host.caret(content.id, caret); }} />
  {:else}
    <div aria-hidden="true" style:height={`${measuredHeight || text.split("\n").length * 20 + 16}px`}></div>
  {/if}
  {@render navigation?.()}
</div>
<style>
  .rendered { padding: 8px 12px; overflow-wrap: anywhere; min-height: 36px; }
  .rendered :global(pre) { overflow-x: auto; }
  /* Horizontal scrolling otherwise makes vertical overflow auto as well. */
  .rendered :global(.katex-display) { overflow-x: auto; overflow-y: hidden; padding-block: 0.25em; }
  .rendered :global(img) { max-width: 100%; }
  .rendered[data-render-type="markdown"] { line-height: 1.6; }
  .rendered[data-render-type="markdown"] :global(p) { margin: 0.75em 0; }
  .rendered[data-render-type="markdown"] :global(h1),
  .rendered[data-render-type="markdown"] :global(h2),
  .rendered[data-render-type="markdown"] :global(h3),
  .rendered[data-render-type="markdown"] :global(h4),
  .rendered[data-render-type="markdown"] :global(h5),
  .rendered[data-render-type="markdown"] :global(h6) { font-weight: 600; line-height: 1.25; margin: 1em 0 0.5em; }
  .rendered[data-render-type="markdown"] :global(h1) { font-size: 2em; }
  .rendered[data-render-type="markdown"] :global(h2) { font-size: 1.5em; }
  .rendered[data-render-type="markdown"] :global(h3) { font-size: 1.25em; }
  .rendered[data-render-type="markdown"] :global(h4) { font-size: 1.125em; }
  .rendered[data-render-type="markdown"] :global(h5),
  .rendered[data-render-type="markdown"] :global(h6) { font-size: 1em; }
  .rendered[data-render-type="markdown"] :global(ul),
  .rendered[data-render-type="markdown"] :global(ol) { margin: 0.75em 0; padding-inline-start: 1.75em; }
  .rendered[data-render-type="markdown"] :global(ul) { list-style: disc outside; }
  .rendered[data-render-type="markdown"] :global(ol) { list-style: decimal outside; }
  .rendered[data-render-type="markdown"] :global(li > p),
  .rendered[data-render-type="markdown"] :global(li > ul),
  .rendered[data-render-type="markdown"] :global(li > ol) { margin: 0.25em 0; }
  .rendered[data-render-type="markdown"] :global(blockquote) { margin: 0.75em 0; padding-inline-start: 1em; border-inline-start: 3px solid #cbd5e1; color: #475569; }
  .rendered[data-render-type="markdown"] :global(pre) { margin: 0.75em 0; padding: 0.75em; border-radius: 4px; background: #f1f5f9; }
  .rendered[data-render-type="markdown"] :global(code) { font-family: monospace; background: #f1f5f9; border-radius: 3px; padding: 0.1em 0.25em; }
  .rendered[data-render-type="markdown"] :global(pre code) { padding: 0; background: transparent; }
  .rendered[data-render-type="markdown"] :global(a) { color: #2563eb; text-decoration: underline; }
  .rendered[data-render-type="markdown"] :global(hr) { margin: 1em 0; border: 0; border-top: 1px solid #cbd5e1; }
  .rendered[data-render-type="markdown"] :global(> :first-child) { margin-top: 0; }
  .rendered[data-render-type="markdown"] :global(> :last-child) { margin-bottom: 0; }
  .content { position: relative; min-width: 0; display: flex; flex-direction: column; outline: none; }
  .linking { cursor: pointer; --editor-background: transparent; }
  .linking:hover { background: #eff6ff; }
  .linking.chosen { box-shadow: inset 0 0 0 2px #2563eb; background: #dbeafe; }
  .content:last-child { flex: 1; }
</style>
