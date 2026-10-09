<script lang="ts">
  import type { Container } from "../schema.js";
  import ContentView from "./ContentView.svelte";
  import ContainerRow from "./ContainerRow.svelte";
  let { container, depth, onenter }: { container: Container; depth: 0 | 1; onenter: (id: string) => void } = $props();
</script>
<div class="right-cell">
  <ContentView content={container.right} label="Right note" side="right" />
  {#if container.right.children.length}
    <button class="go-deeper" onclick={() => onenter(container.id)} aria-label={`Go deeper into ${container.right.text.split("\n")[0] || "Untitled"}`}>Go deeper</button>
    {#if depth === 0}
      <div class="nested">
        {#each container.right.children as child (child.id)}
          <ContainerRow container={child} depth={1} {onenter} />
        {/each}
      </div>
    {/if}
  {/if}
</div>
<style>
  .right-cell { min-width: 0; display: flex; flex-direction: column; border-left: 1px solid #ddd; }
  .go-deeper { align-self: flex-start; margin: 0 12px 12px; padding: 3px 8px; cursor: pointer; }
  .nested { border-top: 1px solid #ddd; }
</style>
