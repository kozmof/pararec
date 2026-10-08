<script lang="ts">
  import { onMount, tick } from "svelte";
  import { TreeStore } from "../lib/tree/tree-store.svelte.js";
  import { createContainer } from "../lib/tree/ops.js";
  import { containerPath, levelAt, pathFromHash, pathHash, validPath } from "../lib/tree/navigation.js";
  import { loadDocument } from "../lib/api/document.js";
  import ContainerRow from "./ContainerRow.svelte";
  import Breadcrumb from "./Breadcrumb.svelte";

  let tree = $state<TreeStore | null>(null);
  let path = $state<string[]>([]);
  let focused = $state<string | null>(null);
  let error = $state("");
  let loading = $state(true);
  let etag = $state<string | null>(null);
  let pad: HTMLElement;
  let addButton = $state<HTMLButtonElement>();
  const focusByLevel = new Map<string, string>();
  let active = true;
  let controller: AbortController;
  let navigationVersion = 0;
  const rows = $derived(tree ? levelAt(tree.schema, path) : []);
  const ancestors = $derived.by(() => {
    if (!tree) return [];
    void tree.schema;
    return path.map(id => tree!.index.get(id)!.container);
  });
  const parent = $derived(ancestors.at(-1));

  function remember(id: string) {
    focused = id;
    focusByLevel.set(pathHash(path), id);
  }
  async function restoreFocus(preferred?: string) {
    const version = ++navigationVersion;
    await tick();
    if (!active || version !== navigationVersion) return;
    const target = preferred ?? focusByLevel.get(pathHash(path));
    const elements = [...pad.querySelectorAll<HTMLElement>("[data-content-id]")];
    const element = elements.find(element => element.dataset.contentId === target) ?? elements.find(element => element.getAttribute("aria-label") === "Right note");
    if (element) element.focus();
    else { focused = null; addButton?.focus(); }
  }
  function navigate(next: string[]) {
    if (!tree) return;
    path = validPath(tree.schema, next);
    const hash = pathHash(path);
    if (window.location.hash !== hash) window.location.hash = hash;
    void restoreFocus();
  }
  function enter(id: string) {
    if (tree) navigate(containerPath(tree.index, id));
  }
  function readHash(restore = true) {
    if (!tree || window.location.hash === "#/editor-demo") return;
    const next = validPath(tree.schema, pathFromHash(window.location.hash));
    const changed = pathHash(next) !== pathHash(path);
    path = next;
    const canonical = pathHash(next);
    if (window.location.hash !== canonical) window.history.replaceState(null, "", canonical);
    if (restore && changed) void restoreFocus();
  }
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const request = controller;
    loading = true;
    error = "";
    try {
      const loaded = await loadDocument(request.signal);
      if (!active || request !== controller) return;
      tree = new TreeStore(loaded.schema);
      etag = loaded.etag;
      readHash(false);
      loading = false;
      await restoreFocus();
    } catch (cause) {
      if (!active || request.signal.aborted) return;
      error = cause instanceof Error ? cause.message : "Unable to load document";
    } finally {
      if (active && request === controller) loading = false;
    }
  }
  function addRow() {
    if (!tree || rows.length) return;
    const container = createContainer();
    tree.apply({ type: "insertContainer", parentId: path.at(-1) ?? null, index: 0, container });
    void restoreFocus(container.right.id);
  }
  $effect(() => {
    if (!tree || loading) return;
    const valid = validPath(tree.schema, path);
    if (valid.length !== path.length) navigate(valid);
    else if (rows.length === 0) void restoreFocus();
  });
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key === ",") {
      event.preventDefault();
      if (path.length) navigate(path.slice(0, -1));
    } else if (event.key === "." && tree && focused) {
      const entry = tree.index.get(focused);
      if (entry?.side === "right" && entry.container.right.children.length) {
        event.preventDefault();
        enter(entry.container.id);
      }
    }
  }
  onMount(() => {
    active = true;
    void load();
    const update = () => readHash();
    window.addEventListener("hashchange", update);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("hashchange", update);
    };
  });
</script>

<svelte:window onkeydown={keydown} />
<main bind:this={pad}>
  <header><h1>Pararec</h1><a href="#/editor-demo">Open editor demo</a></header>
  {#if loading}
    <p role="status">Loading document…</p>
  {:else if error}
    <p role="alert">{error}</p><button onclick={load}>Retry</button>
  {:else if tree}
    <Breadcrumb {ancestors} onup={depth => navigate(path.slice(0, depth))} />
    {#if parent}<div class="parent-heading">{parent.right.text || "Untitled"}</div>{/if}
    <p class="status">Read-only preview. New rows are temporary and disappear on reload.</p>
    <div class="level" data-testid="pad-level" data-etag={etag ?? ""}>
      {#each rows as container (container.id)}
        <ContainerRow {container} onfocus={remember} onenter={enter} />
      {:else}
        <button bind:this={addButton} class="add-row" onclick={addRow}>Add row</button>
      {/each}
    </div>
  {/if}
</main>
<style>
  main { max-width: 1100px; margin: 0 auto; padding: 24px; font-family: system-ui, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  h1 { font-size: 24px; }
  .parent-heading { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 24px; max-height: 72px; overflow: hidden; margin-bottom: 16px; }
  .level { border: 1px solid #ddd; }
  .status { color: #666; font-size: 13px; margin-bottom: 12px; }
  .add-row { width: 100%; padding: 20px; cursor: pointer; }
</style>
