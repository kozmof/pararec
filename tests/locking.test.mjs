import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
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
function launch(document, port, cwd) {
  const child = spawn(
    binary,
    ["open", document, "--port", String(port), "--static", path.dirname(document)],
    { cwd },
  );
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
    const initial = await fetch(`${url}/api/document`);
    const saved = await fetch(`${url}/api/document`, {
      method: "PUT",
      headers: {
        Origin: url,
        "Content-Type": "application/json",
        "If-Match": initial.headers.get("etag"),
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
    await stop(restarted.child);
    const otherDocument = path.join(directory, "other.json");
    await writeFile(otherDocument, '{"version":1,"root":[]}');
    const other = launch(otherDocument, port);
    children.push(other.child);
    assert.equal((await other.ready).listening, true);
  } finally {
    await Promise.all(children.map(stop));
    await rm(directory, { recursive: true, force: true });
  }
});

test("open creates a missing document at the requested relative path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pararec-create-"));
  let server;
  try {
    await mkdir(path.join(directory, "foo"));
    const port = await freePort();
    server = launch("foo/bar.json", port, directory);
    assert.equal((await server.ready).listening, true);
    const document = path.join(directory, "foo/bar.json");
    const bytes = await readFile(document, "utf8");
    const parsed = JSON.parse(bytes);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.title, "bar");
    assert.deepEqual(parsed.root, []);
    assert.deepEqual(await readdir(directory), ["foo"]);
    assert.deepEqual((await readdir(path.join(directory, "foo"))).sort(), [
      "bar.json",
      "bar.json.lock",
    ]);
    const response = await fetch("http://127.0.0.1:" + port + "/api/document");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), bytes);
    await stop(server.child);
    const existing = JSON.stringify({ version: 1, title: "Keep me", root: [] });
    await writeFile(document, existing);
    server = launch("foo/bar.json", port, directory);
    assert.equal((await server.ready).listening, true);
    assert.equal(await readFile(document, "utf8"), existing);
  } finally {
    if (server) await stop(server.child);
    await rm(directory, { recursive: true, force: true });
  }
});
