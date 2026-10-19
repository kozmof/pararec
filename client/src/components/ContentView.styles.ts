import { css } from "../../../styled-system/css";

export const styles = {
  rendered: css({
    "@media (hover: hover)": {
      '& button:hover:where(:not(:disabled):not([aria-checked="true"]))': {
        backgroundColor: "ui.hover",
        color: "ui.accentHover",
        boxShadow: "ui.hover",
      },
    },
    padding: "{spacing.ui.cell} {spacing.ui.gutter}",
    overflowWrap: "anywhere",
    minHeight: "ui.noteMinHeight",
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
      gap: "ui.compact",
    },
    "& .linked-formula > .katex-display": {
      minWidth: "0",
    },
    "& .link-label": {
      background: "ui.hover",
      outline: "ui.annotation",
      outlineOffset: "1px",
      boxDecorationBreak: "clone",
    },
    "& .destinations": {
      display: "inline",
      verticalAlign: "sub",
      fontSize: "ui.annotation",
      lineHeight: "0",
      whiteSpace: "nowrap",
      color: "ui.accent",
      userSelect: "none",
    },
    "& .destinations button": {
      display: "inline-block",
      minWidth: "ui.destination",
      padding: "{spacing.ui.micro} {spacing.ui.compact}",
      border: "0",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      lineHeight: "ui.annotation",
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
      outline: "ui.focus",
      outlineOffset: "2px",
    },
    "& img": {
      maxWidth: "100%",
    },
    '&[data-render-type="markdown"]': {
      lineHeight: "ui.prose",
    },
    '&[data-render-type="markdown"] p': {
      margin: "0.75em 0",
    },
    '&[data-render-type="markdown"] h1': {
      fontWeight: "ui.heading",
      lineHeight: "ui.heading",
      margin: "1em 0 0.5em",
      fontSize: "2em",
    },
    '&[data-render-type="markdown"] h2': {
      fontWeight: "ui.heading",
      lineHeight: "ui.heading",
      margin: "1em 0 0.5em",
      fontSize: "1.5em",
    },
    '&[data-render-type="markdown"] h3': {
      fontWeight: "ui.heading",
      lineHeight: "ui.heading",
      margin: "1em 0 0.5em",
      fontSize: "1.25em",
    },
    '&[data-render-type="markdown"] h4': {
      fontWeight: "ui.heading",
      lineHeight: "ui.heading",
      margin: "1em 0 0.5em",
      fontSize: "1.125em",
    },
    '&[data-render-type="markdown"] h5': {
      fontWeight: "ui.heading",
      lineHeight: "ui.heading",
      margin: "1em 0 0.5em",
      fontSize: "1em",
    },
    '&[data-render-type="markdown"] h6': {
      fontWeight: "ui.heading",
      lineHeight: "ui.heading",
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
      borderInlineStart: "ui.quote",
      color: "ui.proseMuted",
    },
    '&[data-render-type="markdown"] pre': {
      margin: "0.75em 0",
      padding: "0.75em",
      borderRadius: "ui.control",
      background: "ui.code",
    },
    '&[data-render-type="markdown"] code': {
      fontFamily: "code",
      background: "ui.code",
      borderRadius: "ui.code",
      padding: "0.1em 0.25em",
    },
    '&[data-render-type="markdown"] pre code': {
      padding: "0",
      background: "transparent",
    },
    '&[data-render-type="markdown"] a': {
      color: "ui.accent",
      textDecoration: "underline",
    },
    '&[data-render-type="markdown"] hr': {
      margin: "1em 0",
      border: "0",
      borderTop: "ui.prose",
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
      background: "ui.hover",
    },
    "&.linking.chosen": {
      boxShadow: "ui.selected",
      background: "ui.selected",
    },
    "&:last-child": {
      flex: "1",
    },
  }),
};
