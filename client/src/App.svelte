<script lang="ts">
  let status = $state("checking…");

  $effect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: { status: string }) => (status = data.status))
      .catch(() => (status = "unreachable"));
  });
</script>

<h1>Svelte + Zig</h1>
<p>Backend status: <strong>{status}</strong></p>
