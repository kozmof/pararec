import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  presets: ["@pandacss/preset-base", "@pandacss/preset-panda"],
  preflight: true,
  globalCss: {
    button: {
      transition: "background-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
      "@media (prefers-reduced-motion: reduce)": { transition: "none" },
    },
  },
  include: ["./client/src/**/*.{js,jsx,ts,tsx,svelte}"],
  exclude: [],
  theme: {
    extend: {
      semanticTokens: {
        colors: {
          ui: {
            surface: { value: "#ffffff" },
            border: { value: "#ddd" },
            muted: { value: "#666" },
            icon: { value: "#9ca3af" },
            iconHover: { value: "#6b7280" },
            hover: { value: "#eff6ff" },
            selected: { value: "#dbeafe" },
            accent: { value: "#2563eb" },
            accentHover: { value: "#1d4ed8" },
            hoverBorder: { value: "#bfdbfe" },
            annotationBorder: { value: "#93b4de" },
            proseBorder: { value: "#cbd5e1" },
            proseMuted: { value: "#475569" },
            code: { value: "#f1f5f9" },
            warningBorder: { value: "#b78b40" },
          },
        },
      },
      tokens: {
        colors: {
          ink: { black: { value: "#1c1c1c" }, white: { value: "#ffffff" } },
          select: {
            bg: { value: "oklch(93% 0.055 272)" },
            accent: { value: "oklch(62% 0.15 272)" },
          },
        },
        fonts: {
          mono: { value: '"IBM Plex Mono", monospace' },
          ui: { value: "system-ui, sans-serif" },
          code: { value: "monospace" },
        },
        spacing: {
          ui: {
            micro: { value: "2px" },
            compact: { value: "4px" },
            menu: { value: "6px" },
            cell: { value: "8px" },
            control: { value: "10px" },
            gutter: { value: "12px" },
            section: { value: "16px" },
            page: { value: "24px" },
          },
        },
        sizes: {
          ui: {
            destination: { value: "18px" },
            navigation: { value: "24px" },
            addRow: { value: "36px" },
            noteMinHeight: { value: "36px" },
            document: { value: "1100px" },
          },
        },
        fontSizes: {
          ui: {
            annotation: { value: "11px" },
            label: { value: "12px" },
            status: { value: "13px" },
            editor: { value: "12.5px" },
          },
        },
        lineHeights: {
          ui: {
            annotation: { value: "14px" },
            prose: { value: "1.6" },
            heading: { value: "1.25" },
          },
        },
        fontWeights: {
          ui: {
            heading: { value: "600" },
          },
        },
        radii: {
          ui: {
            control: { value: "4px" },
            code: { value: "3px" },
            circle: { value: "50%" },
          },
        },
        borders: {
          ui: {
            divider: { value: "1px solid {colors.ui.border}" },
            annotation: { value: "1px solid {colors.ui.annotationBorder}" },
            focus: { value: "1px solid {colors.ui.accent}" },
            warning: { value: "1px solid {colors.ui.warningBorder}" },
            quote: { value: "3px solid {colors.ui.proseBorder}" },
            prose: { value: "1px solid {colors.ui.proseBorder}" },
          },
        },
        shadows: {
          ui: {
            hover: { value: "inset 0 0 0 1px {colors.ui.hoverBorder}" },
            selected: { value: "inset 0 0 0 2px {colors.ui.accent}" },
            menu: { value: "0 3px 12px #0002" },
          },
        },
      },
    },
  },
  outdir: "styled-system",
});
