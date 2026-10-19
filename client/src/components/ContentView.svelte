<script lang="ts">
  import { cx } from "../../../styled-system/css";
  import { styles } from "./ContentView.styles.js";
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
  const links = $derived(host.linksFor(content.id));
  const rendered = $derived(!editing && !host.linking && renderType !== "none" && renderer ? renderer(text, { links, disabled: host.disabled }) : null);
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
    if (host.disabled) return;
    if (event.button === 2 && rendered !== null) { event.preventDefault(); return; }
    if (event.button !== 0) return;
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
<div use:viewport class={cx("content", styles["content"])} class:linking={host.linking} class:chosen={host.selectedCell?.(content.id)} onkeydown={event => { if (host.linking && !(event.target instanceof Element && event.target.closest("button")) && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); host.selectCell?.(content.id); } }} onclick={event => { const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-render-target]") : null; if (target && !host.disabled && !host.linking) { event.preventDefault(); event.stopPropagation(); host.followLink?.(target.dataset.renderTarget!); } }} oncontextmenu={event => { event.preventDefault(); if (host.disabled || host.linking) return; host.renderMenu?.(content.id, event); const label = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-link-ids]") : null; if (label?.dataset.linkIds) { event.preventDefault(); host.labelMenu?.(content.id, label.dataset.linkIds.split(" "), event); return; } const range = editor?.selected(); if (range && range.end > range.start) { event.preventDefault(); host.linkMenu?.(content.id, range, event); } }} data-content-id={content.id} tabindex="0" role="group" aria-label={label} onfocus={event => { if (event.target instanceof Element && event.target.closest("[data-editor-annotation], a")) return; host.focus(content.id); if (event.target === event.currentTarget && editing) editor?.focus(); }} onfocusout={blur} onmousedown={mousedown}>
  {#if doc && rendered !== null}
    <div use:previewHeight class={cx("rendered", styles["rendered"])} data-render-type={renderType}>{@html rendered}</div>
  {:else if doc}
  <ContentEditor onHeight={height => { measuredHeight = height; }} {links} onDestination={host.followLink} annotationsDisabled={host.linking || host.disabled} bind:this={editor} {doc} active={editing} entry={host.entry} {side} onBoundary={host.boundary} onCommand={host.command} onCaret={caret => { if (editing) host.caret(content.id, caret); }} />
  {:else}
    <div aria-hidden="true" style:height={`${measuredHeight || text.split("\n").length * 20 + 16}px`}></div>
  {/if}
  {@render navigation?.()}
</div>
