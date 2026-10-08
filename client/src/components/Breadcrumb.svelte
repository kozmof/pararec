<script lang="ts">
  import type { Container } from "../schema.js";
  let { ancestors, onup }: { ancestors: Container[]; onup: (depth: number) => void } = $props();
</script>
<nav aria-label="Breadcrumb">
  <button onclick={() => onup(0)} aria-current={ancestors.length === 0 ? "page" : undefined}>Root</button>
  {#each ancestors as ancestor, index (ancestor.id)}
    <span aria-hidden="true">/</span>
    <button onclick={() => onup(index + 1)} aria-current={index === ancestors.length - 1 ? "page" : undefined}>{ancestor.right.text.split("\n")[0] || "Untitled"}</button>
  {/each}
</nav>
<style>
  nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
  button { cursor: pointer; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
