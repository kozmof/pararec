import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: {
    // Output to the repo root, where the Zig server serves it from.
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [
    svelte({
      // Relative to the Vite root (client/).
      configFile: "../svelte.config.js",
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
    }),
  ],
});
