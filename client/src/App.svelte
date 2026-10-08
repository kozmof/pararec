<script lang="ts">
  import "../../styled-system/styles.css";
  import { onMount } from "svelte";
  import EditorDemo from "./lib/editor/EditorDemo.svelte";
  import Pad from "./components/Pad.svelte";
  let demo = $state(false);
  onMount(() => {
    const update = () => (demo = window.location.hash === "#/editor-demo");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  });
</script>
{#if demo}<EditorDemo />{:else}<Pad />{/if}
