import { css } from "../../../styled-system/css";

// Use the same layer as component styles so hover feedback can override base colors.
export const buttonFeedback = css.raw({
  "@media (hover: hover)": {
    '&:hover:where(:not(:disabled):not([aria-checked="true"]))': {
      backgroundColor: "ui.hover",
      color: "ui.accentHover",
      boxShadow: "ui.hover",
    },
  },
});
