import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve("@playwright/test/cli"),
    "test",
    "tests/e2e/performance.spec.ts",
    "--workers=1",
    "--output=test-results/performance",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, PARAREC_PERFORMANCE: "1" },
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
