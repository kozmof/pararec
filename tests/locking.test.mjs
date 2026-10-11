import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const binary = path.resolve(
  `local/zig-out/bin/pararec${process.platform === "win32" ? ".exe" : ""}`,
);
async function freePort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
function launch(document, port) {
  const child = spawn(binary, [
    "open",
    document,
    "--port",
    String(port),
    "--static",
    path.dirname(document),
  ]);
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(output || "Startup timed out"));
    }, 10_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      if (output.includes("listening on")) {
        clearTimeout(timer);
        resolve({ listening: true, output });
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ listening: false, code, output });
    });
  });
  return { child, ready };
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

test("document locks survive replacement, reject aliases, and release after process death", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pararec-lock-"));
  const children = [];
  try {
    await mkdir(path.join(directory, "sub"));
    const document = path.join(directory, "notes.json");
    const port = await freePort();
    const first = launch(document, port);
    children.push(first.child);
    assert.equal((await first.ready).listening, true);
    const url = `http://127.0.0.1:${port}`;
    const missing = await fetch(`${url}/api/document`);
    const identity = missing.headers.get("x-document-id");
    assert.ok(identity);
    const saved = await fetch(`${url}/api/document`, {
      method: "PUT",
      headers: {
        Origin: url,
        "Content-Type": "application/json",
        "If-None-Match": "*",
      },
      body: JSON.stringify({ version: 1, root: [] }),
    });
    assert.equal(saved.status, 200);
    const replaced = await fetch(`${url}/api/document`, {
      method: "PUT",
      headers: {
        Origin: url,
        "Content-Type": "application/json",
        "If-Match": saved.headers.get("etag"),
      },
      body: JSON.stringify({ version: 1, title: "Replacement", root: [] }),
    });
    assert.equal(replaced.status, 200);
    const aliases = [document, `${directory}/sub/../notes.json`];
    if (process.platform !== "win32") {
      const alias = path.join(directory, "alias.json");
      await symlink(document, alias);
      aliases.push(alias);
    }
    for (const alias of aliases) {
      const competing = launch(alias, await freePort());
      children.push(competing.child);
      const result = await competing.ready;
      assert.equal(result.listening, false);
      assert.notEqual(result.code, 0);
      assert.match(result.output, /DocumentAlreadyOpen/);
    }
    await stop(first.child);
    const restarted = launch(document, port);
    children.push(restarted.child);
    assert.equal((await restarted.ready).listening, true);
    assert.equal((await fetch(`${url}/api/document`)).headers.get("x-document-id"), identity);
    await stop(restarted.child);
    const otherDocument = path.join(directory, "other.json");
    await writeFile(otherDocument, '{"version":1,"root":[]}');
    const other = launch(otherDocument, port);
    children.push(other.child);
    assert.equal((await other.ready).listening, true);
    assert.notEqual((await fetch(`${url}/api/document`)).headers.get("x-document-id"), identity);
  } finally {
    await Promise.all(children.map(stop));
    await rm(directory, { recursive: true, force: true });
  }
});
