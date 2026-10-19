<script lang="ts">
  import { cx } from "../../../styled-system/css";
  import { styles } from "./LeftCell.styles.js";
  import ContentView from "./ContentView.svelte";
  import type { Content } from "../schema.js";
  let { contents }: { contents: readonly Content[] } = $props();
</script>
<div class={cx("left-cell", styles["left-cell"])}>
  {#each contents as content (content.id)}
    <ContentView {content} label="Left note" side="left" />
  {/each}
</div>
