<script lang="ts">
  import "../../styled-system/styles.css";
  import Pad from "./components/Pad.svelte";
</script>

<Pad />

<style>
  :global(button) {
    transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
  }
  @media (hover: hover) {
    :global(button:not(:disabled):hover) {
      background-color: #eff6ff;
      color: #1d4ed8;
      box-shadow: inset 0 0 0 1px #bfdbfe;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(button) { transition: none; }
  }
</style>
