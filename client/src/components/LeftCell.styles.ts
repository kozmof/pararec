import { css } from "../../../styled-system/css";

export const styles = {
  "left-cell": css({
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
    "& [data-content-id] + [data-content-id]": {
      borderTop: "ui.divider",
    },
  }),
};
