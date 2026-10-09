<script lang="ts">
  let { direction }: { direction: "up" | "down" } = $props();
</script>

<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  <path d={direction === "up" ? "M12 19V5m-7 7 7-7 7 7" : "M12 5v14m-7-7 7 7 7-7"} />
</svg>
