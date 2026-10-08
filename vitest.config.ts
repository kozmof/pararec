import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte({ configFile: "./svelte.config.js", compilerOptions: { runes: true } })],
  resolve: { conditions: ["browser"] },
  test: {
    include: ["client/src/**/*.test.ts"],
    setupFiles: ["client/src/test-utils/setup.ts"],
    environment: "jsdom",
    maxWorkers: 4,
    restoreMocks: true,
  },
});
