<script lang="ts">
  import { onMount } from "svelte";
  import fixture from "../../../../fixtures/flat.json";
  import EditorSurface from "./EditorSurface.svelte";
  import { EditorDocument, type Caret } from "./document-store.svelte.js";

  const note = fixture.root[0].right;
  const doc = new EditorDocument(note.text);
  let caret = $state<Caret>({ line: 0, column: 0 });
  let anchor = $state<Caret | null>(null);
  let surface: EditorSurface | undefined = $state();

  onMount(() => {
    surface?.focus();
    return () => doc.dispose();
  });
</script>

<main class="demo">
  <a href="#/">Back</a>
  <h1>Editor demo</h1>
  <p>Edit a sample note. Changes stay in this demo until you leave.</p>
  <div class="editor">
    <EditorSurface bind:this={surface} {doc} bind:caret bind:anchor />
  </div>
</main>

<style>
  .demo {
    max-width: 52rem;
    margin: 2rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
  }
  h1 {
    margin: 1rem 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 600;
  }
  p {
    margin-bottom: 1rem;
    color: #575757;
  }
  a {
    color: #3455a0;
    text-decoration: underline;
  }
  .editor {
    display: flex;
    height: min(32rem, 65vh);
    min-height: 12rem;
    border: 1px solid #cccccc;
  }
</style>
