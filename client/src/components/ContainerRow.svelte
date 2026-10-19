<script lang="ts">
  import { cx } from "../../../styled-system/css";
  import { styles } from "./ContainerRow.styles.js";
  import type { Container } from "../schema.js";
  import LeftCell from "./LeftCell.svelte";
  import RightCell from "./RightCell.svelte";
  let { container, depth = 0, onenter }: { container: Container; depth?: 0 | 1; onenter: (id: string) => void } = $props();
</script>
<div class={cx("row", styles["row"])} data-container-id={container.id} data-depth={depth}>
  <LeftCell contents={container.left} />
  <RightCell {container} {depth} {onenter} />
</div>
