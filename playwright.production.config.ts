import { defineConfig } from "@playwright/test";
import development from "./playwright.config.js";

export default defineConfig({
  projects: development.projects,
  forbidOnly: development.forbidOnly,
  retries: development.retries,
  reporter: development.reporter,
  testDir: "./tests/production",
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/production",
  use: { baseURL: "http://127.0.0.1:4547", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node tests/serve-built.mjs",
      url: "http://127.0.0.1:4547/api/health",
      reuseExistingServer: false,
    },
  ],
});
