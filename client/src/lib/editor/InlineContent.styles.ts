import { buttonFeedback } from "../../styles/button.js";
import { css } from "../../../../styled-system/css";

export const styles = {
  preedit: css({
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  }),
  "link-label": css({
    background: "#eff6ff",
    outline: "1px solid #93b4de",
    outlineOffset: "1px",
    boxDecorationBreak: "clone",
  }),
  destinations: css({
    display: "inline",
    position: "relative",
    top: "3px",
    fontSize: "11px",
    lineHeight: "0",
    whiteSpace: "nowrap",
    color: "#2563eb",
    userSelect: "none",
  }),
  button: css({
    ...buttonFeedback,
    display: "inline-block",
    boxSizing: "border-box",
    minWidth: "18px",
    padding: "2px 4px",
    border: "0",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    lineHeight: "14px",
    cursor: "pointer",
    "&:not(:disabled):hover": {
      textDecoration: "underline",
    },
    "&:focus-visible": {
      outline: "1px solid #2563eb",
      outlineOffset: "2px",
    },
  }),
};
