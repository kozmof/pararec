import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  presets: ["@pandacss/preset-base", "@pandacss/preset-panda"],
  preflight: true,
  include: ["./client/src/**/*.{js,jsx,ts,tsx,svelte}"],
  exclude: [],
  theme: {
    extend: {
      tokens: {
        colors: {
          ink: { black: { value: "#1c1c1c" }, white: { value: "#ffffff" } },
          select: {
            bg: { value: "oklch(93% 0.055 272)" },
            accent: { value: "oklch(62% 0.15 272)" },
          },
        },
        fonts: { mono: { value: '"IBM Plex Mono", monospace' } },
      },
    },
  },
  outdir: "styled-system",
});
