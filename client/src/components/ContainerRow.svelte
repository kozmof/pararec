<script lang="ts">
  import type { Container } from "../schema.js";
  import LeftCell from "./LeftCell.svelte";
  import RightCell from "./RightCell.svelte";
  let { container, depth = 0, onenter }: { container: Container; depth?: 0 | 1; onenter: (id: string) => void } = $props();
</script>
<div class="row" data-container-id={container.id} data-depth={depth}>
  <LeftCell contents={container.left} />
  <RightCell {container} {depth} {onenter} />
</div>
<style>
  .row { display: grid; grid-template-columns: minmax(0, 35fr) minmax(0, 65fr); border-bottom: 1px solid #ddd; }
  .row:last-child { border-bottom: 0; }
</style>
