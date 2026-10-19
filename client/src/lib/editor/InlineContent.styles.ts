import { buttonFeedback } from "../../styles/button.js";
import { css } from "../../../../styled-system/css";

export const styles = {
  preedit: css({
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  }),
  "link-label": css({
    background: "ui.hover",
    outline: "ui.annotation",
    outlineOffset: "1px",
    boxDecorationBreak: "clone",
  }),
  destinations: css({
    display: "inline",
    position: "relative",
    top: "3px",
    fontSize: "ui.annotation",
    lineHeight: "0",
    whiteSpace: "nowrap",
    color: "ui.accent",
    userSelect: "none",
  }),
  button: css({
    ...buttonFeedback,
    display: "inline-block",
    boxSizing: "border-box",
    minWidth: "ui.destination",
    padding: "{spacing.ui.micro} {spacing.ui.compact}",
    border: "0",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    lineHeight: "ui.annotation",
    cursor: "pointer",
    "&:not(:disabled):hover": {
      textDecoration: "underline",
    },
    "&:focus-visible": {
      outline: "ui.focus",
      outlineOffset: "2px",
    },
  }),
};
