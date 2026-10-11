import { defineConfig } from "@playwright/test";
import development from "./playwright.config.js";

export default defineConfig(development, {
  testDir: "./tests/production",
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/production",
  use: { baseURL: "http://127.0.0.1:4547" },
  webServer: {
    command: "node tests/serve-built.mjs",
    url: "http://127.0.0.1:4547/api/health",
    reuseExistingServer: false,
  },
});
