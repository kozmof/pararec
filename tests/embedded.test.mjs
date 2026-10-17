import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("standalone binary serves every embedded asset without a static directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pararec-embedded-"));
  const name = `pararec${process.platform === "win32" ? ".exe" : ""}`;
  let server;
  try {
    await copyFile(path.resolve("local/zig-out/bin", name), path.join(directory, name));
    await copyFile("fixtures/flat.json", path.join(directory, "notes.json"));
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    server = spawn(path.join(directory, name), ["open", "notes.json", "--port", String(port)], {
      cwd: directory,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10000);
      const finish = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      server.once("error", finish);
      server.once("exit", (code) => finish(new Error(`Server exited (${code}): ${output}`)));
      server.stderr.on("data", (chunk) => {
        output += chunk;
        if (output.includes("listening on")) finish();
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const index = await readFile("dist/index.html");
    async function verify(relative = "") {
      for (const entry of await readdir(path.join("dist", relative), { withFileTypes: true })) {
        const asset = relative + entry.name;
        if (entry.isDirectory()) {
          await verify(asset + "/");
          continue;
        }
        const bytes = await readFile(path.join("dist", asset));
        const response = await fetch(`${origin}/${asset}`);
        assert.equal(response.status, 200, asset);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, asset);
        assert.equal(
          response.headers.get("cache-control"),
          asset.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
        assert.ok(response.headers.get("content-type"), asset);
        const head = await fetch(`${origin}/${asset}`, { method: "HEAD" });
        assert.equal(head.status, 200, asset);
        assert.equal(head.headers.get("content-length"), String(bytes.length), asset);
        assert.equal((await head.arrayBuffer()).byteLength, 0);
      }
    }
    await verify();
    for (const route of ["/", "/nested/notebook"]) {
      assert.deepEqual(Buffer.from(await (await fetch(origin + route)).arrayBuffer()), index);
    }
    assert.equal((await fetch(origin + "/missing.js")).status, 404);
    assert.equal((await fetch(origin + "/assets/%2e%2e%2fsecret")).status, 400);
    assert.equal((await fetch(origin + "/api/document")).status, 200);
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["notes.json", "notes.json.lock", name].sort(),
    );
  } finally {
    if (server && server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
