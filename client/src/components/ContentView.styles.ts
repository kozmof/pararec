import { css } from "../../../styled-system/css";

export const styles = {
  rendered: css({
    "@media (hover: hover)": {
      '& button:hover:where(:not(:disabled):not([aria-checked="true"]))': {
        backgroundColor: "#eff6ff",
        color: "#1d4ed8",
        boxShadow: "inset 0 0 0 1px #bfdbfe",
      },
    },
    padding: "8px 12px",
    overflowWrap: "anywhere",
    minHeight: "36px",
    "& pre": {
      overflowX: "auto",
    },
    "& .katex-display": {
      overflowX: "auto",
      overflowY: "hidden",
      paddingBlock: "0.25em",
    },
    "& .linked-formula": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "4px",
    },
    "& .linked-formula > .katex-display": {
      minWidth: "0",
    },
    "& .link-label": {
      background: "#eff6ff",
      outline: "1px solid #93b4de",
      outlineOffset: "1px",
      boxDecorationBreak: "clone",
    },
    "& .destinations": {
      display: "inline",
      verticalAlign: "sub",
      fontSize: "11px",
      lineHeight: "0",
      whiteSpace: "nowrap",
      color: "#2563eb",
      userSelect: "none",
    },
    "& .destinations button": {
      display: "inline-block",
      minWidth: "18px",
      padding: "2px 4px",
      border: "0",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      lineHeight: "14px",
      cursor: "pointer",
    },
    "& .katex .destinations": {
      verticalAlign: "baseline",
      font: "inherit",
      lineHeight: "inherit",
    },
    "& .katex svg": {
      pointerEvents: "none",
    },
    "& .katex .hide-tail": {
      pointerEvents: "none",
    },
    "& .katex .katex-strut": {
      pointerEvents: "none",
    },
    "& .katex .pstrut": {
      pointerEvents: "none",
    },
    "& .katex .destinations button": {
      position: "relative",
      zIndex: "1",
      pointerEvents: "auto",
      minWidth: "0",
      padding: "0",
      font: "inherit",
      lineHeight: "inherit",
    },
    "& .destinations button:hover": {
      textDecoration: "underline",
    },
    "& .destinations button:focus-visible": {
      outline: "1px solid #2563eb",
      outlineOffset: "2px",
    },
    "& img": {
      maxWidth: "100%",
    },
    '&[data-render-type="markdown"]': {
      lineHeight: "1.6",
    },
    '&[data-render-type="markdown"] p': {
      margin: "0.75em 0",
    },
    '&[data-render-type="markdown"] h1': {
      fontWeight: "600",
      lineHeight: "1.25",
      margin: "1em 0 0.5em",
      fontSize: "2em",
    },
    '&[data-render-type="markdown"] h2': {
      fontWeight: "600",
      lineHeight: "1.25",
      margin: "1em 0 0.5em",
      fontSize: "1.5em",
    },
    '&[data-render-type="markdown"] h3': {
      fontWeight: "600",
      lineHeight: "1.25",
      margin: "1em 0 0.5em",
      fontSize: "1.25em",
    },
    '&[data-render-type="markdown"] h4': {
      fontWeight: "600",
      lineHeight: "1.25",
      margin: "1em 0 0.5em",
      fontSize: "1.125em",
    },
    '&[data-render-type="markdown"] h5': {
      fontWeight: "600",
      lineHeight: "1.25",
      margin: "1em 0 0.5em",
      fontSize: "1em",
    },
    '&[data-render-type="markdown"] h6': {
      fontWeight: "600",
      lineHeight: "1.25",
      margin: "1em 0 0.5em",
      fontSize: "1em",
    },
    '&[data-render-type="markdown"] ul': {
      margin: "0.75em 0",
      paddingInlineStart: "1.75em",
      listStyle: "disc outside",
    },
    '&[data-render-type="markdown"] ol': {
      margin: "0.75em 0",
      paddingInlineStart: "1.75em",
      listStyle: "decimal outside",
    },
    '&[data-render-type="markdown"] li > p': {
      margin: "0.25em 0",
    },
    '&[data-render-type="markdown"] li > ul': {
      margin: "0.25em 0",
    },
    '&[data-render-type="markdown"] li > ol': {
      margin: "0.25em 0",
    },
    '&[data-render-type="markdown"] blockquote': {
      margin: "0.75em 0",
      paddingInlineStart: "1em",
      borderInlineStart: "3px solid #cbd5e1",
      color: "#475569",
    },
    '&[data-render-type="markdown"] pre': {
      margin: "0.75em 0",
      padding: "0.75em",
      borderRadius: "4px",
      background: "#f1f5f9",
    },
    '&[data-render-type="markdown"] code': {
      fontFamily: "monospace",
      background: "#f1f5f9",
      borderRadius: "3px",
      padding: "0.1em 0.25em",
    },
    '&[data-render-type="markdown"] pre code': {
      padding: "0",
      background: "transparent",
    },
    '&[data-render-type="markdown"] a': {
      color: "#2563eb",
      textDecoration: "underline",
    },
    '&[data-render-type="markdown"] hr': {
      margin: "1em 0",
      border: "0",
      borderTop: "1px solid #cbd5e1",
    },
    '&[data-render-type="markdown"] > :first-child': {
      marginTop: "0",
    },
    '&[data-render-type="markdown"] > :last-child': {
      marginBottom: "0",
    },
  }),
  content: css({
    position: "relative",
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
    outline: "none",
    "&.linking": {
      cursor: "pointer",
      "--editor-background": "transparent",
    },
    "&.linking:not(.chosen):hover": {
      background: "#eff6ff",
    },
    "&.linking.chosen": {
      boxShadow: "inset 0 0 0 2px #2563eb",
      background: "#dbeafe",
    },
    "&:last-child": {
      flex: "1",
    },
  }),
};
