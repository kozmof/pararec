import { buttonFeedback } from "../styles/button.js";
import { css } from "../../../styled-system/css";

export const styles = {
  "right-cell": css({
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
    borderLeft: "ui.divider",
  }),
  "go-deeper": css({
    ...buttonFeedback,
    alignSelf: "flex-end",
    margin: "auto {spacing.ui.cell} {spacing.ui.cell} auto",
    padding: "ui.compact",
    width: "ui.navigation",
    height: "ui.navigation",
    color: "ui.icon",
    boxSizing: "border-box",
    border: "1px solid currentColor",
    borderRadius: "ui.circle",
    background: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    "&:hover": {
      color: "ui.iconHover",
    },
  }),
  nested: css({
    borderTop: "ui.divider",
  }),
};
