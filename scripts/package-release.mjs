import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const name = `pararec-${process.platform}-${process.arch}.tar.gz`;
await mkdir("release", { recursive: true });
const binary = `pararec${process.platform === "win32" ? ".exe" : ""}`;
execFileSync("tar", ["-czf", path.resolve("release", name), "-C", "local/zig-out/bin", binary], {
  stdio: "inherit",
});
const hash = createHash("sha256")
  .update(await readFile(path.join("release", name)))
  .digest("hex");
await writeFile(path.join("release", name + ".sha256"), `${hash}  ${name}\n`);
console.log(path.join("release", name));
