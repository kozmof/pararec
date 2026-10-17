import { cp, mkdir, readdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const [source, output] = process.argv.slice(2);
await access(path.join(source, "index.html")).catch(() => {
  throw new Error("Client build is missing. Run pnpm build:client before zig build.");
});
await mkdir(output, { recursive: true });
const assets = [];
async function walk(directory, prefix = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + "/");
    else if (entry.isFile()) assets.push(name);
    else throw new Error(`Unsupported client asset: ${name}`);
  }
}
await walk(source);
await cp(source, path.join(output, "files"), { recursive: true });
// JSON string escaping is valid Zig syntax for these Vite-generated paths.
const entries = assets
  .map(
    (name) =>
      `    .{ .path = ${JSON.stringify(name)}, .bytes = @embedFile(${JSON.stringify("files/" + name)}) },`,
  )
  .join("\n");
await writeFile(
  path.join(output, "assets.zig"),
  `pub const Asset = struct { path: []const u8, bytes: []const u8 };\npub const files = [_]Asset{\n${entries}\n};\n`,
);
