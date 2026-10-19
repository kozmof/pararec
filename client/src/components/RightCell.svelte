<script lang="ts">
  import { cx } from "../../../styled-system/css";
  import { styles } from "./RightCell.styles.js";
  import type { Container } from "../schema.js";
  import ContentView from "./ContentView.svelte";
  import ArrowIcon from "./ArrowIcon.svelte";
  import ContainerRow from "./ContainerRow.svelte";
  let { container, depth, onenter }: { container: Container; depth: 0 | 1; onenter: (id: string) => void } = $props();
</script>
<div class={cx("right-cell", styles["right-cell"])}>
  <ContentView content={container.right} label="Right note" side="right">
    {#snippet navigation()}
      {#if container.right.children.length}
        <button class={cx("go-deeper", styles["go-deeper"])} title="Go deeper" onclick={() => onenter(container.id)} aria-label={`Go deeper into ${container.right.text.split("\n")[0] || "Untitled"}`}><ArrowIcon direction="down" /></button>
      {/if}
    {/snippet}
  </ContentView>
  {#if container.right.children.length}
    {#if depth === 0}
      <div class={cx("nested", styles["nested"])}>
        {#each container.right.children as child (child.id)}
          <ContainerRow container={child} depth={1} {onenter} />
        {/each}
      </div>
    {/if}
  {/if}
</div>
