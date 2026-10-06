import { defineConfig } from '@pandacss/dev'

export default defineConfig({
  presets: ['@pandacss/preset-base', '@pandacss/preset-panda'],
  preflight: true,
  include: ['./client/src/**/*.{js,jsx,ts,tsx,svelte}'],
  exclude: [],
  theme: {
    extend: {},
  },
  outdir: "styled-system",
})
