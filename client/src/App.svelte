<script lang="ts">
  import "../../styled-system/styles.css";
  import { css } from "../../styled-system/css";

  let status = $state("checking…");

  $effect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: { status: string }) => (status = data.status))
      .catch(() => (status = "unreachable"));
  });
</script>

<h1 class={css({ color: "blue.500" })}>Svelte + Zig</h1>
<p>Backend status: <strong>{status}</strong></p>
