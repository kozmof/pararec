<script lang="ts">
  import type { Container } from "../schema.js";
  import ContentView from "./ContentView.svelte";
  import ArrowIcon from "./ArrowIcon.svelte";
  import ContainerRow from "./ContainerRow.svelte";
  let { container, depth, onenter }: { container: Container; depth: 0 | 1; onenter: (id: string) => void } = $props();
</script>
<div class="right-cell">
  <ContentView content={container.right} label="Right note" side="right">
    {#snippet navigation()}
      {#if container.right.children.length}
        <button class="go-deeper" title="Go deeper" onclick={() => onenter(container.id)} aria-label={`Go deeper into ${container.right.text.split("\n")[0] || "Untitled"}`}><ArrowIcon direction="down" /></button>
      {/if}
    {/snippet}
  </ContentView>
  {#if container.right.children.length}
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
  .go-deeper { align-self: flex-end; margin: auto 8px 8px auto; padding: 4px; width: 24px; height: 24px; color: #9ca3af; box-sizing: border-box; border: 1px solid currentColor; border-radius: 50%; background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .go-deeper:hover { color: #6b7280; }
  .nested { border-top: 1px solid #ddd; }
</style>
