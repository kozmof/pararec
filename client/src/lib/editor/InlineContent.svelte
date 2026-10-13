<script lang="ts">
  import { inlinePresentation, type InlineDecoration } from "./inline-rendering.js";
  let { text, line, decorations = [], preedit = "", column = 0, onDestination, disabled = false }: {
    preedit?: string;
    column?: number;
    text: string;
    line: number;
    decorations?: readonly InlineDecoration[];
    onDestination?: (id: string) => void;
    disabled?: boolean;
  } = $props();
  const presentation = $derived(inlinePresentation(text, line, decorations, preedit, preedit ? column : 0));
</script>

{#each presentation.runs as run (`${run.from}:${run.to}`)}<span
  class:link-label={run.decorations.length > 0}
  data-link-ids={run.decorations.length ? run.decorations.map(item => item.id).join(" ") : undefined}
>{#each run.parts as part (part.from)}<span data-from={part.from} class:preedit={part.preedit} data-preedit={part.preedit ? "" : undefined}>{presentation.text.slice(part.from, part.to)}</span>{/each}</span>{#each run.endings as decoration (decoration.id)}<span class="destinations" data-link-ids={decoration.id} data-editor-annotation aria-label="Linked cells">{#each decoration.destinations as destination, index (destination.id)}{#if index > 0}<span aria-hidden="true">,</span>{/if}<button
  type="button" {disabled}
  aria-label={`Linked cell ${index + 1}: ${destination.label}`}
  title={destination.label}
  onmousedown={event => { event.preventDefault(); event.stopPropagation(); }}
  onclick={event => { event.stopPropagation(); onDestination?.(destination.id); }}
>{index + 1}</button>{/each}</span>{/each}{/each}

<style>
  .preedit { text-decoration: underline; text-underline-offset: 2px; }
  .link-label { background: #eff6ff; outline: 1px solid #93b4de; outline-offset: 1px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .destinations { display: inline; position: relative; top: 3px; font-size: 11px; line-height: 0; white-space: nowrap; color: #2563eb; user-select: none; }
  button { display: inline-block; box-sizing: border-box; min-width: 18px; padding: 2px 4px; border: 0; background: transparent; color: inherit; font: inherit; line-height: 14px; cursor: pointer; }
  button:not(:disabled):hover { text-decoration: underline; }
  button:focus-visible { outline: 1px solid #2563eb; outline-offset: 2px; }
</style>
