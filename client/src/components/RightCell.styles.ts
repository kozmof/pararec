import { buttonFeedback } from "../styles/button.js";
import { css } from "../../../styled-system/css";

export const styles = {
  "right-cell": css({
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid #ddd",
  }),
  "go-deeper": css({
    ...buttonFeedback,
    alignSelf: "flex-end",
    margin: "auto 8px 8px auto",
    padding: "4px",
    width: "24px",
    height: "24px",
    color: "#9ca3af",
    boxSizing: "border-box",
    border: "1px solid currentColor",
    borderRadius: "50%",
    background: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    "&:hover": {
      color: "#6b7280",
    },
  }),
  nested: css({
    borderTop: "1px solid #ddd",
  }),
};
