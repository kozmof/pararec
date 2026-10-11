import { defineConfig } from "@playwright/test";
import production from "./playwright.production.config.js";

export default defineConfig(production, {
  testDir: "./tests/e2e",
  testMatch: "performance.spec.ts",
  outputDir: "test-results/performance",
});
