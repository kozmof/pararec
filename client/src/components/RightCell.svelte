<script lang="ts">
  import type { Container } from "../schema.js";
  import ContainerRow from "./ContainerRow.svelte";
  let { container, depth, onfocus, onenter }: { container: Container; depth: 0 | 1; onfocus: (id: string) => void; onenter: (id: string) => void } = $props();
</script>
<div class="right-cell">
  <div class="content" tabindex="0" role="textbox" aria-readonly="true" aria-label="Right note" data-content-id={container.right.id} onfocus={() => onfocus(container.right.id)}>{container.right.text || "\u200b"}</div>
  {#if container.right.children.length}
    <button class="count" onclick={() => onenter(container.id)} aria-label={`Open children of ${container.right.text.split("\n")[0] || "Untitled"}`}>{container.right.children.length} {container.right.children.length === 1 ? "child" : "children"}</button>
    {#if depth === 0}
      <div class="nested">
        {#each container.right.children as child (child.id)}
          <ContainerRow container={child} depth={1} {onfocus} {onenter} />
        {/each}
      </div>
    {/if}
  {/if}
</div>
<style>
  .right-cell { min-width: 0; border-left: 1px solid #ddd; }
  .content { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; min-height: 44px; }
  .content:focus { outline: 2px solid #6883b5; outline-offset: -2px; }
  .count { margin: 0 12px 12px; padding: 3px 8px; cursor: pointer; }
  .nested { border-top: 1px solid #ddd; }
</style>
