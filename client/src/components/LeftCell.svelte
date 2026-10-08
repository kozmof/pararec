<script lang="ts">
  import type { Content } from "../schema.js";
  let { contents, onfocus }: { contents: Content[]; onfocus: (id: string) => void } = $props();
</script>
<div class="left-cell">
  {#each contents as content (content.id)}
    <div class="content" tabindex="0" role="textbox" aria-readonly="true" aria-label="Left note" data-content-id={content.id} onfocus={() => onfocus(content.id)}>{content.text || "\u200b"}</div>
  {/each}
</div>
<style>
  .left-cell { min-width: 0; }
  .content { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; min-height: 44px; }
  .content + .content { border-top: 1px solid #ddd; }
  .content:focus { outline: 2px solid #6883b5; outline-offset: -2px; }
</style>
