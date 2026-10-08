<script lang="ts">
  import type { Action } from "svelte/action";
  import { css } from "../../../../styled-system/css";

  let { line, text, top, padding = 12, rowHeight = 20, preedit = "", column = 0, register }: {
    line: number;
    text: string;
    top: number;
    padding?: number;
    rowHeight?: number;
    preedit?: string;
    column?: number;
    register: Action<HTMLDivElement, number>;
  } = $props();
</script>

<div
  use:register={line}
  class={css({ position: "absolute", left: "0", right: "0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", zIndex: "1" })}
  data-line={line}
  style:top={`${top}px`}
  style:line-height={`${rowHeight}px`}
  style:min-height={`${rowHeight}px`}
  style:padding-left={`${padding}px`}
  style:padding-right={`${padding}px`}
>{#if preedit}<span data-from="0">{text.slice(0, column)}</span
  ><span
    class={css({ textDecoration: "underline", textUnderlineOffset: "2px" })}
    data-from={column}
    data-preedit>{preedit}</span
  ><span data-from={column + preedit.length}>{text.slice(column)}</span
  >{:else}<span data-from="0">{text}</span>{/if}</div>
