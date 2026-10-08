<script lang="ts">
  import { onMount, setContext, tick } from "svelte";
  import type { Schema } from "../schema.js";
  import { TreeStore } from "../lib/tree/tree-store.svelte.js";
  import { createContainer } from "../lib/tree/ops.js";
  import { structureAction, type StructureCommand } from "../lib/tree/structure.js";
  import type { Caret } from "../lib/editor/document-store.svelte.js";
  import { containerPath, levelAt, pathFromHash, pathHash, validPath } from "../lib/tree/navigation.js";
  import { loadDocument, type LoadedDocument } from "../lib/api/document.js";
  import { SaveSession } from "../lib/api/save-session.svelte.js";
  import { IndexedRecovery, type RecoverySnapshot } from "../lib/api/recovery.js";
  import { ContentCache } from "../lib/editor/content-cache.js";
  import { CONTENT_HOST, type ContentHost, type Entry, type Boundary, type Command } from "../lib/editor/content-host.js";
  import ContainerRow from "./ContainerRow.svelte";
  import Breadcrumb from "./Breadcrumb.svelte";

  let tree = $state<TreeStore | null>(null);
  let session = $state<SaveSession | null>(null);
  let cache = $state<ContentCache>();
  let path = $state<string[]>([]);
  let focused = $state<string | null>(null);
  let entry = $state<Entry>({ kind: "edge", edge: "start" });
  let error = $state("");
  let recoveryError = $state("");
  let loading = $state(true);
  let busy = $state(false);
  let recoverySnapshot = $state.raw<RecoverySnapshot | null>(null);
  let confirmRestore = $state(false);
  let pad: HTMLElement;
  let addButton = $state<HTMLButtonElement>();
  const recovery = new IndexedRecovery();
  const focusByLevel = new Map<string, string>();
  let active = true;
  let controller: AbortController;
  let navigationVersion = 0;
  let seenSchema: Schema | null = null;
  let loadedSchema: Schema | null = null;
  const disabled = $derived(busy || recoverySnapshot !== null || session?.status === "conflict");
  const rows = $derived(tree ? levelAt(tree.schema, path) : []);
  const ancestors = $derived.by(() => {
    if (!tree) return [];
    void tree.schema;
    return validPath(tree.schema, path).map(id => tree!.index.get(id)!.container);
  });
  const parent = $derived(ancestors.at(-1));
  setContext<ContentHost>(CONTENT_HOST, {
    get focused() { return focused; }, get cache() { return cache!; }, get entry() { return entry; }, get disabled() { return disabled; },
    focus: remember, blur, boundary, command,
  });
  function modal(node: HTMLDialogElement) {
    let mounted = true;
    void tick().then(() => { if (!mounted) return; if (typeof node.showModal === "function") node.showModal(); else node.open = true; node.querySelector<HTMLButtonElement>("button")?.focus(); });
    return { destroy() { mounted = false; if (node.open && typeof node.close === "function") node.close(); } };
  }
  function changed() {
    if (!tree || !session) return;
    seenSchema = tree.schema;
    session.changed(tree.schema);
  }
  function install(loaded: LoadedDocument) {
    cache?.dispose();
    session?.dispose();
    tree = new TreeStore(loaded.schema);
    seenSchema = loadedSchema = tree.schema;
    session = new SaveSession(loaded, recovery);
    cache = new ContentCache(tree, changed);
    focused = null;
    focusByLevel.clear();
    entry = { kind: "edge", edge: "start" };
    readHash(false);
  }
  function remember(id: string, nextEntry?: Entry) {
    if (disabled || !tree?.index.has(id)) return;
    if (focused !== id) entry = nextEntry ?? { kind: "edge", edge: "start" };
    focused = id;
    focusByLevel.set(pathHash(path), id);
  }
  function blur(id: string) {
    if (focused !== id) return;
    if (tree?.index.has(id)) cache?.get(id).closeHistoryGroup();
    focused = null;
    void session?.flush();
  }
  async function restoreFocus(preferred?: string, nextEntry?: Entry) {
    const version = ++navigationVersion;
    await tick();
    if (!active || disabled || version !== navigationVersion) return;
    const target = preferred ?? focusByLevel.get(pathHash(path));
    const elements = [...pad.querySelectorAll<HTMLElement>("[data-content-id]")];
    const element = elements.find(element => element.dataset.contentId === target) ?? elements.find(element => element.getAttribute("aria-label") === "Right note");
    if (element) {
      if (nextEntry) { if (focused && focused !== element.dataset.contentId) blur(focused); focused = element.dataset.contentId!; entry = nextEntry; focusByLevel.set(pathHash(path), focused); }
      element.focus();
    } else { focused = null; addButton?.focus(); }
  }
  function navigate(next: string[]) {
    if (!tree || disabled) return;
    if (focused) blur(focused);
    path = validPath(tree.schema, next);
    const hash = pathHash(path);
    if (window.location.hash !== hash) window.location.hash = hash;
    void restoreFocus();
  }
  function enter(id: string) { if (tree) navigate(containerPath(tree.index, id)); }
  function readHash(restore = true) {
    if (!tree || window.location.hash === "#/editor-demo") return;
    const next = validPath(tree.schema, pathFromHash(window.location.hash));
    const changed = pathHash(next) !== pathHash(path);
    if (changed && focused) blur(focused);
    path = next;
    const canonical = pathHash(next);
    if (window.location.hash !== canonical) window.history.replaceState(null, "", canonical);
    if (restore && changed) void restoreFocus();
  }
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const request = controller;
    loading = true; error = "";
    try {
      const [loaded, record] = await Promise.allSettled([loadDocument(request.signal), recovery.read()]);
      if (!active || request !== controller) return;
      if (loaded.status === "rejected") throw loaded.reason;
      install(loaded.value);
      if (record.status === "fulfilled") {
        recoverySnapshot = record.value;
        if (recoverySnapshot && JSON.stringify(recoverySnapshot.schema) === JSON.stringify(loaded.value.schema)) {
          recoverySnapshot = null;
          void recovery.clear().catch(cause => { recoveryError = String(cause); });
        }
      } else recoveryError = `Local recovery is unavailable. ${String(record.reason)}`;
      loading = false;
      if (!recoverySnapshot) await restoreFocus();
    } catch (cause) { if (active && !request.signal.aborted) error = cause instanceof Error ? cause.message : "Unable to load document"; }
    finally { if (active && request === controller) loading = false; }
  }
  function addRow() {
    if (!tree || rows.length || disabled) return;
    const container = createContainer();
    tree.apply({ type: "insertContainer", parentId: path.at(-1) ?? null, index: 0, container });
    changed();
    void restoreFocus(container.right.id);
  }
  async function reload() {
    if (!session || busy) return;
    busy = true;
    try { const loaded = await session.reload(); if (active) install(loaded); }
    catch (cause) { if (session) session.error = String(cause); }
    finally { busy = false; if (active) void restoreFocus(); }
  }
  async function overwrite() {
    if (!session || busy) return;
    busy = true;
    try { await session.overwrite(); } finally { busy = false; if (active && session.status !== "conflict") void restoreFocus(); }
  }
  async function restoreRecovery() {
    if (!recoverySnapshot || !tree || !session) return;
    if (!confirmRestore && JSON.stringify(recoverySnapshot.base) !== JSON.stringify(loadedSchema)) { confirmRestore = true; return; }
    const snapshot = recoverySnapshot;
    cache?.dispose();
    tree = new TreeStore(snapshot.schema);
    cache = new ContentCache(tree, changed);
    focused = null; focusByLevel.clear();
    recoverySnapshot = null; confirmRestore = false;
    readHash(false);
    changed();
    await restoreFocus();
  }
  async function discardRecovery() {
    try { await recovery.clear(); } catch (cause) { recoveryError = String(cause); }
    recoverySnapshot = null; confirmRestore = false;
    await restoreFocus();
  }
  function boundary(direction: Boundary, goalX: number) {
    if (!tree || !focused) return;
    const current = tree.index.get(focused)!;
    const visible = [...pad.querySelectorAll<HTMLElement>("[data-content-id]")];
    const depth = visible.find(element => element.dataset.contentId === focused)?.closest<HTMLElement>("[data-depth]")?.dataset.depth;
    const notes = visible.filter(element => tree!.index.get(element.dataset.contentId!)?.side === current.side && element.closest<HTMLElement>("[data-depth]")?.dataset.depth === depth);
    const at = notes.findIndex(element => element.dataset.contentId === focused);
    const backwards = direction === "up" || direction === "left";
    const target = notes[at + (backwards ? -1 : 1)];
    if (!target) return;
    void restoreFocus(target.dataset.contentId, { kind: "edge", edge: backwards ? "end" : "start", ...((direction === "up" || direction === "down") ? { goalX } : {}) });
  }
  function command(command: Command, caret: Caret = { line: 0, column: 0 }) {
    if (command === "save") { void session?.flush(); return; }
    if (command === "leave") { if (path.length) navigate(path.slice(0, -1)); return; }
    if (!tree || !focused) return;
    if (["split", "newSibling", "newChild", "join", "deleteContainer", "moveUp", "moveDown"].includes(command)) {
      const action = structureAction(tree.schema, tree.index, path, focused, caret, command as StructureCommand);
      if (!action || disabled) return;
      cache?.get(focused).closeHistoryGroup();
      tree.applyMany(action.ops);
      focused = null;
      cache?.dispose();
      cache = new ContentCache(tree, changed);
      path = action.path;
      const hash = pathHash(path);
      if (window.location.hash !== hash) window.location.hash = hash;
      changed();
      void restoreFocus(action.focus?.contentId, action.focus?.entry);
      return;
    }
    const current = tree.index.get(focused)!;
    if (command === "enter") { if (current.side === "right" && current.container.right.children.length) enter(current.container.id); }
    else if (command === "otherColumnLeft" && current.side === "right") void restoreFocus(current.container.left[0].id);
    else if (command === "otherColumnRight" && current.side === "left") void restoreFocus(current.container.right.id);
    // Integrated undo and redo belong to app snapshot history in P11.
  }
  $effect(() => {
    if (!tree || loading) return;
    void tree.schema;
    cache?.prune();
    if (seenSchema !== tree.schema) changed();
    const valid = validPath(tree.schema, path);
    if (valid.length !== path.length) navigate(valid);
    else if (rows.length === 0) void restoreFocus();
  });
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || disabled) return;
    if (event.key === ",") { event.preventDefault(); command("leave"); }
    else if (event.key === ".") { event.preventDefault(); command("enter"); }
    else if (event.key.toLowerCase() === "s") { event.preventDefault(); command("save"); }
  }
  onMount(() => {
    active = true; void load();
    const update = () => readHash();
    const visibility = () => { if (document.visibilityState === "hidden") void session?.flush(); };
    const unload = (event: BeforeUnloadEvent) => { if (session?.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("hashchange", update);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; controller?.abort(); cache?.dispose(); session?.dispose(); window.removeEventListener("hashchange", update); window.removeEventListener("beforeunload", unload); document.removeEventListener("visibilitychange", visibility); };
  });
</script>
<svelte:window onkeydown={keydown} />
<main bind:this={pad}>
  <header><h1>Pararec</h1><a href="#/editor-demo">Open editor demo</a></header>
  {#if loading}<p role="status">Loading document…</p>
  {:else if error}<p role="alert">{error}</p><button onclick={load}>Retry</button>
  {:else if tree && session}
    <div class="save-status" role="status">{session.status === "saved" ? "Saved" : session.status === "saving" ? "Saving…" : session.status === "dirty" ? "Unsaved changes" : session.status === "conflict" ? "File changed on disk" : "Save failed"}</div>
    {#if session.status === "failed"}<p role="alert">{session.error}</p><button onclick={() => session?.flush()}>Retry save</button>{/if}
    {#if session.status === "conflict"}<dialog use:modal oncancel={event => event.preventDefault()} aria-label="File changed on disk" aria-modal="true"><p>The file changed on disk. Reload the disk version or overwrite it with your notes.</p>{#if session.error}<p>{session.error}</p>{/if}<button disabled={busy} onclick={reload}>Reload</button><button disabled={busy} onclick={overwrite}>Overwrite</button></dialog>{/if}
    {#if recoveryError || session.recoveryError}<p role="alert">{recoveryError || session.recoveryError}</p>{/if}
    {#if recoverySnapshot}<dialog use:modal oncancel={event => event.preventDefault()} aria-label="Recover unsaved notes" aria-modal="true"><p>{confirmRestore ? "The disk document has changed since these notes were saved locally. Confirm restoring your notes over the current disk version." : "Unsaved notes are available from an earlier session."}</p><button onclick={restoreRecovery}>{confirmRestore ? "Confirm restore" : "Restore"}</button><button onclick={discardRecovery}>Discard</button></dialog>{/if}
    <div inert={disabled}>
      <Breadcrumb {ancestors} onup={depth => navigate(path.slice(0, depth))} />
      {#if parent}<div class="parent-heading">{parent.right.text || "Untitled"}</div>{/if}
      <div class="level" data-testid="pad-level" data-etag={session.etag ?? ""}>
        {#each rows as container (container.id)}<ContainerRow {container} onenter={enter} />
        {:else}<button bind:this={addButton} class="add-row" onclick={addRow}>Add row</button>{/each}
      </div>
    </div>
  {/if}
</main>
<style>
  main { max-width: 1100px; margin: 0 auto; padding: 24px; font-family: system-ui, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  h1 { font-size: 24px; }
  .parent-heading { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 24px; max-height: 72px; overflow: hidden; margin-bottom: 16px; }
  .level { border: 1px solid #ddd; }
  .save-status { color: #666; font-size: 13px; margin-bottom: 12px; }
  .add-row { width: 100%; padding: 20px; cursor: pointer; }
  dialog { border: 1px solid #b78b40; padding: 16px; margin-bottom: 16px; }
  button { cursor: pointer; }
</style>
