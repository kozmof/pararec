import { css } from "../../../styled-system/css";

export const styles = {
  row: css({
    display: "grid",
    gridTemplateColumns: "minmax(0, var(--outer-left, 35fr)) minmax(0, var(--outer-right, 65fr))",
    '&[data-depth="1"]': {
      gridTemplateColumns: "minmax(0, var(--inner-left, 35fr)) minmax(0, var(--inner-right, 65fr))",
    },
    borderBottom: "ui.divider",
    "&:last-child": {
      borderBottom: "0",
    },
  }),
};
