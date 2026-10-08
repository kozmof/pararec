<script lang="ts">
  import "../../styled-system/styles.css";
  import { onMount } from "svelte";
  import EditorDemo from "./lib/editor/EditorDemo.svelte";
  import { css } from "../../styled-system/css";

  let status = $state("checking…");
  let demo = $state(false);

  onMount(() => {
    const update = () => (demo = window.location.hash === "#/editor-demo");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  });

  $effect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: { status: string }) => (status = data.status))
      .catch(() => (status = "unreachable"));
  });
</script>

{#if demo}
  <EditorDemo />
{:else}
  <h1 class={css({ color: "blue.500" })}>Svelte + Zig</h1>
  <p>Backend status: <strong>{status}</strong></p>
  <a href="#/editor-demo">Open editor demo</a>
{/if}
