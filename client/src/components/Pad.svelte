<script lang="ts">
  import { onMount, setContext, tick } from "svelte";
  import type { Schema } from "../schema.js";
  import { TreeStore } from "../lib/tree/tree-store.svelte.js";
  import { createContainer } from "../lib/tree/ops.js";
  import { structureAction, type StructureCommand } from "../lib/tree/structure.js";
  import type { Caret } from "../lib/editor/document-store.svelte.js";
  import { containerPath, layerDepth, levelAt, pathFromHash, pathHash, validPath } from "../lib/tree/navigation.js";
  import { loadDocument, type LoadedDocument } from "../lib/api/document.js";
  import { SaveSession } from "../lib/api/save-session.svelte.js";
  import { AppHistory, type AppSnapshot, type FocusSnapshot } from "../lib/history/history.svelte.js";
  import { ContentCache, type ContentChange } from "../lib/editor/content-cache.js";
  import { CONTENT_HOST, type ContentHost, type Entry, type Boundary, type Command } from "../lib/editor/content-host.js";
  import ContainerRow from "./ContainerRow.svelte";
  import ContentView from "./ContentView.svelte";
  import ArrowIcon from "./ArrowIcon.svelte";

  let linkMenu = $state<{ sourceId: string; start: number; end: number; x: number; y: number; labelIds?: readonly string[] } | null>(null);
  let menuElement: HTMLDivElement | undefined = $state();
  function dismissMenuOutside(event: MouseEvent) {
    if (linkMenu && event.target instanceof Node && !menuElement?.contains(event.target)) linkMenu = null;
  }
  let linking = $state<{ sourceId: string; start: number; end: number; targets: string[] } | null>(null);
  function finishLink() {
    if (!tree || !linking || !linking.targets.length || disabled) return;
    const before = snapshot();
    tree.apply({ type: "setLinks", links: [...(tree.schema.links ?? []), { id: crypto.randomUUID(), ...linking, targets: [...linking.targets] }] });
    history.record(before, snapshot());
    const source = linking.sourceId;
    linking = null; changed(); void restoreFocus(source);
  }
  function destinationName(id: string) {
    const item = tree?.index.get(id);
    if (!item || item.side === "container") return "Missing cell";
    const text = item.side === "right" ? item.container.right.text : item.container.left[item.index].text;
    return text.replace(/\s+/g, " ").trim().slice(0, 60) || "Empty cell";
  }
  function removeLabel(id: string, targetId?: string) {
    if (!tree || disabled || linking) return;
    const link = tree.schema.links?.find(link => link.id === id);
    if (!link || (targetId && !link.targets.includes(targetId))) return;
    const before = snapshot(focusSnapshot(link.sourceId));
    history.closeGroup();
    cache?.get(link.sourceId).closeHistoryGroup();
    const remaining = targetId ? link.targets.filter(target => target !== targetId) : [];
    tree.apply({ type: "setLinks", links: (tree.schema.links ?? []).flatMap(item => item.id !== id ? [item] : remaining.length ? [{ ...item, targets: remaining }] : []) });
    cache?.get(link.sourceId);
    history.record(before, snapshot(before.focus));
    linkMenu = null;
    changed();
    void restoreFocus(link.sourceId);
  }
  function cancelLink() { const source = linking?.sourceId ?? linkMenu?.sourceId; linking = null; linkMenu = null; if (source) void restoreFocus(source); }
  let tree = $state<TreeStore | null>(null);
  let session = $state<SaveSession | null>(null);
  let cache = $state<ContentCache>();
  let path = $state<string[]>([]);
  let focused = $state<string | null>(null);
  let entry = $state<Entry>({ kind: "edge", edge: "start" });
  let error = $state("");
  let loading = $state(true);
  let busy = $state(false);
  let pad: HTMLElement;
  let addButton = $state<HTMLButtonElement>();
  let titleInput = $state<HTMLInputElement>();
  let titleComposing = false;
  const history = new AppHistory();
  let liveCaret: Caret | null = null;
  const focusByLevel = new Map<string, string>();
  let active = true;
  let controller: AbortController;
  let navigationVersion = 0;
  let seenSchema: Schema | null = null;
  const disabled = $derived(busy || session?.status === "conflict");
  const rows = $derived(tree ? levelAt(tree.schema, path) : []);
  const currentLayer = $derived(tree ? validPath(tree.schema, path).length + 1 : 1);
  const totalLayers = $derived(tree ? layerDepth(tree.schema) : 1);
  const ancestors = $derived.by(() => {
    if (!tree) return [];
    void tree.schema;
    return validPath(tree.schema, path).map(id => tree!.index.get(id)!.container);
  });
  const parent = $derived(ancestors.at(-1));
  setContext<ContentHost>(CONTENT_HOST, {
    get focused() { return focused; }, get cache() { return cache!; }, get entry() { return entry; }, get disabled() { return disabled; },
    get linking() { return !!linking; }, get links() { return tree?.schema.links?.filter(link => tree!.index.has(link.sourceId)).map(link => ({ ...link, targets: link.targets.filter(id => tree!.index.has(id)) })); },
    selectedCell: id => linking?.targets.includes(id) ?? false,
    selectCell: id => { if (linking && id !== linking.sourceId) linking = { ...linking, targets: linking.targets.includes(id) ? linking.targets.filter(target => target !== id) : [...linking.targets, id] }; },
    linkMenu: (sourceId, range, event) => { linkMenu = { sourceId, ...range, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 50) }; },
    labelMenu: (sourceId, ids, event) => {
      if (disabled || linking || !tree) return;
      const labels = (tree.schema.links ?? []).filter(link => link.sourceId === sourceId && ids.includes(link.id));
      if (!labels.length) return;
      linkMenu = { sourceId, start: labels[0].start, end: labels[0].end, labelIds: labels.map(link => link.id), x: Math.max(0, Math.min(event.clientX, window.innerWidth - 300)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 180)) };
    },
    followLink: id => {
      if (!tree || disabled) return;
      const item = tree.index.get(id);
      if (!item || item.side === "container") return;
      const visible = [...pad.querySelectorAll<HTMLElement>("[data-content-id]")].some(element => element.dataset.contentId === id);
      if (!visible) navigate(containerPath(tree.index, item.container.id).slice(0, -1));
      void restoreFocus(id);
    },
    focus: remember, blur, boundary, command, caret: reportCaret,
  });
  function modal(node: HTMLDialogElement) {
    let mounted = true;
    void tick().then(() => { if (!mounted) return; if (typeof node.showModal === "function") node.showModal(); else node.open = true; node.querySelector<HTMLButtonElement>("button")?.focus(); });
    return { destroy() { mounted = false; if (node.open && typeof node.close === "function") node.close(); } };
  }
  function focusSnapshot(contentId = focused, place?: Entry): FocusSnapshot | null {
    if (!tree || !contentId) return null;
    const row = tree.index.get(contentId);
    if (!row || row.side === "container") return null;
    const text = row.side === "right" ? row.container.right.text : row.container.left[row.index].text;
    const target = place ?? (liveCaret ? { kind: "caret", ...liveCaret } as Entry : entry);
    const lines = text.split("\n");
    return { contentId, ...(target.kind === "caret" ? { line: target.line, column: target.column, ...(target.affinity ? { affinity: target.affinity } : {}) } : target.edge === "end" ? { line: lines.length - 1, column: lines.at(-1)!.length } : { line: 0, column: 0 }) };
  }
  function snapshot(focus = focusSnapshot()): AppSnapshot { return { schema: tree!.schema, path: [...path], focus }; }
  function reportCaret(id: string, caret: Caret) {
    if (id !== focused) return;
    if (liveCaret && (liveCaret.line !== caret.line || liveCaret.column !== caret.column || liveCaret.affinity !== caret.affinity)) history.closeGroup();
    liveCaret = { ...caret };
  }
  function changed(edit?: ContentChange) {
    if (edit) {
      const beforeCaret = edit.beforeCaret ?? liveCaret ?? { line: 0, column: 0 };
      const afterCaret = edit.afterCaret ?? beforeCaret;
      history.record({ schema: edit.before, path: [...path], focus: { contentId: edit.contentId, ...beforeCaret } },
        { schema: edit.after, path: [...path], focus: { contentId: edit.contentId, ...afterCaret } },
        !edit.before.links?.some(link => link.sourceId === edit.contentId) && edit.kind === "edit" && edit.groupable && edit.intent && edit.intent !== "replace" ? { contentId: edit.contentId, intent: edit.intent, group: edit.group } : undefined, edit.before.links?.some(link => link.sourceId === edit.contentId) ? undefined : edit.textChange, edit.textPatch);
      liveCaret = { ...afterCaret };
    }
    if (!tree || !session) return;
    seenSchema = tree.schema;
    session.changed(tree.schema);
  }
  function editTitle(value: string) {
    if (!tree || disabled || value === tree.schema.title) return;
    const before = snapshot();
    tree.apply({ type: "setTitle", title: value });
    history.record(before, snapshot());
    changed();
  }
  function install(loaded: LoadedDocument) {
    history.clear();
    linking = null; linkMenu = null;
    liveCaret = null;
    cache?.dispose();
    session?.dispose();
    tree = new TreeStore(loaded.schema);
    seenSchema = tree.schema;
    session = new SaveSession(loaded);
    cache = new ContentCache(tree, changed);
    focused = null;
    focusByLevel.clear();
    entry = { kind: "edge", edge: "start" };
    readHash(false);
  }
  function remember(id: string, nextEntry?: Entry) {
    if (disabled || linking || !tree?.index.has(id)) return;
    if (focused !== id) { history.closeGroup(); liveCaret = null; entry = nextEntry ?? { kind: "edge", edge: "start" }; }
    focused = id;
    focusByLevel.set(pathHash(path), id);
  }
  function blur(id: string) {
    if (focused !== id) return;
    history.closeGroup(); liveCaret = null;
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
    const element = elements.find(element => element.dataset.contentId === target) ?? elements.find(element => element.closest('[data-testid="pad-level"]') && element.getAttribute("aria-label") === "Right note");
    if (element) {
      if (nextEntry) { if (focused && focused !== element.dataset.contentId) blur(focused); focused = element.dataset.contentId!; entry = nextEntry; focusByLevel.set(pathHash(path), focused); }
      else if (!linking) remember(element.dataset.contentId!);
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
    if (!tree) return;
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
      const loaded = await loadDocument(request.signal);
      if (!active || request !== controller) return;
      install(loaded);
      loading = false;
      await restoreFocus();
    } catch (cause) { if (active && !request.signal.aborted) error = cause instanceof Error ? cause.message : "Unable to load document"; }
    finally { if (active && request === controller) loading = false; }
  }
  function addRow() {
    if (!tree || rows.length || disabled) return;
    const before = snapshot();
    const container = createContainer();
    tree.apply({ type: "insertContainer", parentId: path.at(-1) ?? null, index: 0, container });
    history.record(before, snapshot({ contentId: container.right.id, line: 0, column: 0 }));
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
  function boundary(direction: Boundary, goalX: number) {
    const backwards = direction === "up" || direction === "left";
    moveCell(direction, { kind: "edge", edge: backwards ? "end" : "start", ...((direction === "up" || direction === "down") ? { goalX } : {}) });
  }
  function moveCell(direction: Boundary, nextEntry: Entry = { kind: "edge", edge: "start" }) {
    if (!tree || !focused || disabled) return;
    const current = tree.index.get(focused);
    if (!current || current.side === "container") return;
    const visibleRows = [...pad.querySelectorAll<HTMLElement>("[data-container-id]")]
      .map(element => tree!.index.get(element.dataset.containerId!)!.container);
    const topIds = new Set([...rows.map(row => row.id), ...(parent ? [parent.id] : [])]);
    const nested = !topIds.has(current.container.id);
    let target: string | undefined;
    if (direction === "left" || direction === "right") {
      const notes = [...pad.querySelectorAll<HTMLElement>("[data-content-id]")].map(element => element.dataset.contentId!);
      const at = notes.indexOf(focused);
      const firstLeft = current.container.left[0].id;
      if (direction === "right" && current.side === "left") {
        target = current.container.right.id;
      } else {
        target = direction === "left" && current.side === "right" && notes.includes(firstLeft)
          ? firstLeft : notes[at + (direction === "left" ? -1 : 1)];
      }
    } else {
      const backwards = direction === "up";
      if (current.side === "right") {
        const at = visibleRows.findIndex(row => row.id === current.container.id);
        const next = visibleRows[at + (backwards ? -1 : 1)];
        const enteringChild = !backwards && next && current.container.right.children.some(child => child.id === next.id);
        const enteringPreviousChildren = backwards && !nested && next && !topIds.has(next.id);
        target = enteringChild ? next.left[0].id
          : enteringPreviousChildren ? next.left.at(-1)?.id : next?.right.id;
      } else {
        const siblings = nested ? tree.index.get(current.parentId!)!.container.right.children : rows;
        const notes = siblings.flatMap(row => row.left);
        const at = notes.findIndex(note => note.id === focused);
        target = notes[at + (backwards ? -1 : 1)]?.id;
        if (!target && backwards && !nested && parent && current.container.id !== parent.id) target = parent.right.id;
        if (!target && nested) {
          const parent = tree.index.get(current.parentId!)!.container;
          const after = visibleRows.findIndex(row => row.id === siblings.at(-1)?.id) + 1;
          target = backwards ? parent.right.id : visibleRows[after]?.right.id;
        }
      }
    }
    if (target) void restoreFocus(target, nextEntry);
  }
  function command(command: Command, caret: Caret = { line: 0, column: 0 }) {
    const direction = ({ focusLeft: "left", focusRight: "right", focusUp: "up", focusDown: "down" } as Partial<Record<Command, Boundary>>)[command];
    if (direction) { moveCell(direction); return; }
    if (command === "undo" || command === "redo") {
      if (disabled || !tree) return;
      const target = command === "undo" ? history.undo() : history.redo();
      if (target) {
        const editingTitle = document.activeElement === titleInput;
        const nextPath = validPath(target.schema, target.path);
        // Moving a focused subtree can blur its textarea in browsers. Structural
        // restores must reactivate it after the DOM has settled.
        const keepEditor = !!target.textChange && focused !== null && focused === target.focus?.contentId && pathHash(path) === pathHash(nextPath);
        if (!keepEditor) focused = null;
        liveCaret = null;
        const previous = target.textChange ? tree.index.get(target.textChange.contentId) : undefined;
        const previousText = previous && previous.side !== "container"
          ? previous.side === "right" ? previous.container.right.text : previous.container.left[previous.index].text : undefined;
        tree.restore(target.schema);
        cache?.restoreText(target.textChange, previousText);
        path = nextPath; focusByLevel.clear();
        if (keepEditor && target.focus) entry = { kind: "caret", ...target.focus };
        const hash = pathHash(path); if (window.location.hash !== hash) window.location.hash = hash;
        changed();
        if (!editingTitle && !keepEditor) void restoreFocus(target.focus?.contentId, target.focus ? { kind: "caret", ...target.focus } : undefined);
      }
      return;
    }
    if (command === "save") { void session?.flush(); return; }
    if (!tree || !focused) return;
    if (["split", "newSibling", "newChild", "removeRow", "removeLeft", "removeChildren", "moveUp", "moveDown"].includes(command)) {
      const action = structureAction(tree.schema, tree.index, path, focused, caret, command as StructureCommand);
      if (!action || disabled) return;
      const before = snapshot({ contentId: focused, ...caret });
      history.closeGroup();
      cache?.get(focused).closeHistoryGroup();
      tree.applyMany(action.ops);
      focused = null;
      cache?.dispose();
      cache = new ContentCache(tree, changed);
      path = action.path; liveCaret = null;
      history.record(before, snapshot(action.focus ? focusSnapshot(action.focus.contentId, action.focus.entry) : null));
      const hash = pathHash(path);
      if (window.location.hash !== hash) window.location.hash = hash;
      changed();
      void restoreFocus(action.focus?.contentId, action.focus?.entry);
      return;
    }

  }
  $effect(() => {
    if (!tree || loading) return;
    void tree.schema;
    cache?.prune();
    if (seenSchema !== tree.schema) changed();
    const valid = validPath(tree.schema, path);
    if (valid.length !== path.length) navigate(valid);
    else if (rows.length === 0 && document.activeElement !== titleInput) void restoreFocus();
  });
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape" && (linking || linkMenu)) { event.preventDefault(); cancelLink(); return; }
    if (linking) return;
    if (event.isComposing || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || disabled) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); command(event.shiftKey ? "redo" : "undo"); }
    else if (event.key.toLowerCase() === "y") { event.preventDefault(); command("redo"); }
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
    document.addEventListener("click", dismissMenuOutside, true);
    return () => { active = false; controller?.abort(); cache?.dispose(); session?.dispose(); window.removeEventListener("hashchange", update); window.removeEventListener("beforeunload", unload); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("click", dismissMenuOutside, true); };
  });
</script>
<svelte:window onkeydown={keydown} />
<main bind:this={pad}
  style:max-width={`${tree?.schema.config.maxWidth ?? 1100}px`}
  style:--outer-left={(tree?.schema.config.outerWidthRate?.left ?? 35) + "fr"}
  style:--outer-right={(tree?.schema.config.outerWidthRate?.right ?? 65) + "fr"}
  style:--inner-left={(tree?.schema.config.innerIdthRate?.left ?? 35) + "fr"}
  style:--inner-right={(tree?.schema.config.innerIdthRate?.right ?? 65) + "fr"}>
  {#if loading}<p role="status">Loading document…</p>
  {:else if error}<p role="alert">{error}</p><button onclick={load}>Retry</button>
  {:else if tree && session}
    {#if linkMenu}
      <div bind:this={menuElement} class="link-menu" role="menu" tabindex="-1" oncontextmenu={event => event.preventDefault()} style:left={linkMenu.x + "px"} style:top={linkMenu.y + "px"}>
        {#if linkMenu.labelIds}
          {#each linkMenu.labelIds as id, index (id)}
            <button role="menuitem" disabled={disabled} onclick={() => removeLabel(id)}>{linkMenu.labelIds.length === 1 ? "Remove label" : `Remove label ${index + 1}`}</button>
            {#each tree.schema.links?.find(link => link.id === id)?.targets ?? [] as target, destinationIndex (target)}
              <button class="remove-destination" title={destinationName(target)} role="menuitem" disabled={disabled} onclick={() => removeLabel(id, target)}>Remove {destinationIndex + 1}</button>
            {/each}
          {/each}
        {:else}
        <button role="menuitem" onclick={() => { if (linkMenu) { const { sourceId, start, end } = linkMenu; linking = { sourceId, start, end, targets: [] }; linkMenu = null; if (focused) blur(focused); } }}>Start linking</button>
        {/if}
      </div>
    {/if}
    {#if linking}<div class="link-toolbar" role="region" aria-label="Link selected text"><span>Select cells to link ({linking.targets.length})</span><button disabled={!linking.targets.length || disabled} onclick={finishLink}>Done</button><button onclick={cancelLink}>Cancel</button></div>{/if}
    {#if tree.schema.config.showTitles}
      <div class="document-title"><input bind:this={titleInput} class="title-input" aria-label="Document title" value={tree.schema.title} disabled={disabled || !!linking}
        onfocus={() => { if (focused) blur(focused); history.closeGroup(); }}
        oncompositionstart={() => { titleComposing = true; }}
        oninput={event => { if (!titleComposing) editTitle(event.currentTarget.value); }}
        oncompositionend={event => { titleComposing = false; editTitle(event.currentTarget.value); }}
        onblur={() => { history.closeGroup(); void session?.flush(); }}
        onkeydown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} /></div>
    {/if}
    <div class="status-row">
    <div class="save-status" role="status">{session.status === "saved" ? "Saved" : session.status === "saving" ? "Saving…" : session.status === "dirty" ? "Unsaved changes" : session.status === "conflict" ? "File changed on disk" : "Save failed"}</div>
      <span class="layer-status" role="status" aria-label="Current layer" title={`Layer ${currentLayer} of ${totalLayers}`}>{currentLayer}:{totalLayers}</span>
    </div>
    {#if session.status === "failed"}<p role="alert">{session.error}</p><button onclick={() => session?.flush()}>Retry save</button>{/if}
    {#if session.status === "conflict"}<dialog use:modal oncancel={event => event.preventDefault()} aria-label="File changed on disk" aria-modal="true"><p>The file changed on disk. Reload the disk version or overwrite it with your notes.</p>{#if session.error}<p>{session.error}</p>{/if}<button disabled={busy} onclick={reload}>Reload</button><button disabled={busy} onclick={overwrite}>Overwrite</button></dialog>{/if}
    <div inert={disabled}>
      {#if parent}<div class="level parent-row" data-testid="parent-level" data-container-id={parent.id} data-depth="0"><ContentView content={parent.right} label="Right note" side="right">{#snippet navigation()}<button class="go-back" title="Go back" aria-label="Go back" onclick={() => navigate(path.slice(0, -1))}><ArrowIcon direction="up" /></button>{/snippet}</ContentView></div>{/if}
      <div class="level" class:empty={rows.length === 0} data-testid="pad-level" data-etag={session.etag ?? ""}>
        {#each rows as container (container.id)}<ContainerRow {container} onenter={enter} />
        {:else}<button bind:this={addButton} class="add-row" aria-label="Add row" title="Add row" onclick={addRow}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg></button>{/each}
      </div>
    </div>
  {/if}
</main>
<style>
  .link-menu { max-width: min(300px, calc(100vw - 16px)); max-height: min(400px, 70vh); overflow: auto; position: fixed; z-index: 100; background: white; border: 1px solid #ddd; padding: 6px; box-shadow: 0 3px 12px #0002; display: flex; flex-direction: column; }
  .remove-destination { text-align: left; overflow-wrap: anywhere; }
  .link-toolbar { position: sticky; top: 0; z-index: 10; background: #eff6ff; padding: 10px; display: flex; gap: 12px; align-items: center; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; font-family: system-ui, sans-serif; }
  .status-row { display: flex; align-items: baseline; gap: 16px; margin-bottom: 12px; }
  .document-title { min-width: 0; font-size: 1em; font-weight: normal; margin: 0.67em 0; }
  .layer-status { margin-left: auto; flex-shrink: 0; color: #666; font-size: 13px; font-variant-numeric: tabular-nums; }
  .title-input { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 4px; padding: 4px; }
  .title-input:hover { border-color: #ddd; }
  .title-input:focus { outline: none; }
  .level { border: 1px solid #ddd; }
  .level.empty { border: 0; display: flex; justify-content: center; }
  .parent-row { border-bottom: 0; display: flex; flex-direction: column; }
  .go-back { align-self: flex-end; margin: 0 8px 8px auto; padding: 4px; width: 24px; height: 24px; color: #9ca3af; box-sizing: border-box; border: 1px solid currentColor; border-radius: 50%; background: transparent; display: inline-flex; align-items: center; justify-content: center; }
  .go-back:hover { color: #6b7280; }
  .save-status { color: #666; font-size: 13px; }
  .add-row { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; box-sizing: border-box; margin: 8px; padding: 0; color: #6b7280; background: transparent; border: 1px solid #ddd; border-radius: 50%; cursor: pointer; }
  .add-row:focus { outline: none; }
  dialog { border: 1px solid #b78b40; padding: 16px; margin-bottom: 16px; }
  button { cursor: pointer; }
</style>
