<script lang="ts">
  import { cx } from "../../../../styled-system/css";
  import { styles } from "./InlineContent.styles.js";
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

<!-- Source offsets move while typing; keep the span slots and destination controls mounted. -->
{#each presentation.runs as run, runIndex (runIndex)}<span
  class={run.decorations.length > 0 ? cx("link-label", styles["link-label"]) : undefined}
  data-link-ids={run.decorations.length ? run.decorations.map(item => item.id).join(" ") : undefined}
>{#each run.parts as part, partIndex (partIndex)}<span data-from={part.from} class={part.preedit ? cx("preedit", styles.preedit) : undefined} data-preedit={part.preedit ? "" : undefined}>{presentation.text.slice(part.from, part.to)}</span>{/each}</span>{#each run.endings as decoration (decoration.id)}<span class={cx("destinations", styles["destinations"])} data-link-ids={decoration.id} data-editor-annotation aria-label="Linked cells">{#each decoration.destinations as destination, index (destination.id)}{#if index > 0}<span aria-hidden="true">,</span>{/if}<button class={styles.button}
  type="button" {disabled}
  aria-label={`Linked cell ${index + 1}: ${destination.label}`}
  title={destination.label}
  onmousedown={event => { event.preventDefault(); event.stopPropagation(); }}
  onclick={event => { event.stopPropagation(); onDestination?.(destination.id); }}
>{index + 1}</button>{/each}</span>{/each}{/each}
