import { css } from "../../../styled-system/css";

export const styles = {
  row: css({
    display: "grid",
    gridTemplateColumns: "minmax(0, var(--outer-left, 2fr)) minmax(0, var(--outer-right, 8fr))",
    '&[data-depth="1"]': {
      gridTemplateColumns: "minmax(0, var(--inner-left, 2fr)) minmax(0, var(--inner-right, 8fr))",
    },
    borderBottom: "ui.divider",
    "&:last-child": {
      borderBottom: "0",
    },
  }),
};
