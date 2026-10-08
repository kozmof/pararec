<script lang="ts">
  import ContentView from "./ContentView.svelte";
  import type { Content } from "../schema.js";
  let { contents }: { contents: Content[] } = $props();
</script>
<div class="left-cell">
  {#each contents as content (content.id)}
    <ContentView {content} label="Left note" side="left" />
  {/each}
</div>
<style>
  .left-cell { min-width: 0; }
  .left-cell :global([data-content-id] + [data-content-id]) { border-top: 1px solid #ddd; }
</style>
