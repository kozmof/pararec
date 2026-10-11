import { spawn } from "node:child_process";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(os.tmpdir(), "pararec-browser-"));
const document = path.join(directory, "notes.json");
await copyFile("fixtures/flat.json", document);
const server = spawn(
  path.resolve(`local/zig-out/bin/pararec${process.platform === "win32" ? ".exe" : ""}`),
  ["open", document, "--port", "4547", "--static", path.resolve("dist")],
  { stdio: "inherit" },
);
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.kill());
server.on("error", async (error) => {
  console.error(error);
  await rm(directory, { recursive: true, force: true });
  process.exitCode = 1;
});
server.on("exit", async (code) => {
  await rm(directory, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
