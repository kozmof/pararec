import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";

let directory;
let documentPath;
let server;
let port;
const empty = { version: 1, root: [] };
const origin = () => `http://127.0.0.1:${port}`;
const etag = (bytes) => `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`;

before(async () => {
  directory = await mkdtemp(path.resolve("local/.zig-cache/pararec-api-"));
  documentPath = path.join(directory, "document.json");
  await mkdir(path.join(directory, "static"));
  await writeFile(path.join(directory, "static/index.html"), "<!doctype html><h1>Pararec</h1>");
  await writeFile(
    path.join(directory, "static/favicon.svg"),
    await readFile("client/public/favicon.svg"),
  );
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  server = spawn(
    path.resolve("local/zig-out/bin/pararec"),
    ["serve", documentPath, "--port", String(port), "--static", path.join(directory, "static")],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000);
    server.once("error", reject);
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited (${code}): ${output}`));
    });
    server.stderr.on("data", (chunk) => {
      output += chunk;
      if (output.includes("listening on")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(method = "GET", endpoint = "/api/document", headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method, path: endpoint, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Request timed out")));
    req.end(body);
  });
}

const put = (document, headers = {}) =>
  request(
    "PUT",
    "/api/document",
    { origin: origin(), "content-type": "application/json", ...headers },
    typeof document === "string" ? document : JSON.stringify(document),
  );

// Keep cases sequential because they share one document.
test("document API over real sockets", async (t) => {
  await t.test("missing files return 404 and creation requires a precondition", async () => {
    assert.equal((await request()).status, 404);
    assert.equal((await put(empty)).status, 428);
    assert.equal((await put(empty, { "if-match": "*" })).status, 412);
    const response = await put(empty, { "if-none-match": "*" });
    assert.equal(response.status, 200);
    const disk = await readFile(documentPath, "utf8");
    assert.equal(disk, '{\n  "version": 1,\n  "root": []\n}\n');
    assert.equal(response.headers.etag, etag(disk));
    assert.equal((await put(empty, { "if-none-match": "*" })).status, 412);
  });
  await t.test("GET and PUT ETags correspond to exact file bytes", async () => {
    for (const fixture of ["flat", "three-levels", "long", "empty"]) {
      const previous = await request();
      assert.equal(previous.headers.etag, etag(previous.body));
      const document = JSON.parse(await readFile(`fixtures/${fixture}.json`, "utf8"));
      const saved = await put(document, { "if-match": previous.headers.etag });
      assert.equal(saved.status, 200);
      const loaded = await request();
      assert.deepEqual(JSON.parse(loaded.body), document);
      assert.equal(saved.headers.etag, etag(loaded.body));
      assert.equal(loaded.headers.etag, saved.headers.etag);
      assert.equal(await readFile(`${documentPath}.bak`, "utf8"), previous.body);
    }
  });
  await t.test("stale ETags and external edits are preserved", async () => {
    const before = await request();
    const external = JSON.stringify({ ...empty, external: "preserve" });
    await writeFile(documentPath, external);
    assert.equal((await put(empty, { "if-match": before.headers.etag })).status, 412);
    assert.equal(await readFile(documentPath, "utf8"), external);
  });
  await t.test("concurrent saves with the same ETag have one winner", async () => {
    const current = await request();
    const documents = await Promise.all(
      ["flat", "three-levels"].map(async (name) =>
        JSON.parse(await readFile(`fixtures/${name}.json`, "utf8")),
      ),
    );
    const responses = await Promise.all(
      documents.map((document) => put(document, { "if-match": current.headers.etag })),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 412]);
    const winner = responses.findIndex((response) => response.status === 200);
    assert.deepEqual(JSON.parse((await request()).body), documents[winner]);
  });
  await t.test("invalid JSON and each schema invariant return 400 without writing", async () => {
    const before = await request();
    const row = {
      id: "row",
      left: [{ id: "left", text: "" }],
      right: { id: "right", text: "", children: [] },
    };
    const cases = [
      "{",
      { version: 2, root: [] },
      { version: 1, root: [{ ...row, left: [] }] },
      { version: 1, root: [{ ...row, right: { ...row.right, id: "row" } }] },
      { version: 1, root: [{ ...row, right: { ...row.right, id: "left" } }] },
      { version: 1, root: [{ ...row, left: [{ id: "left", text: "a\rb" }] }] },
      { version: 1, root: [row, { ...row, id: "other" }] },
    ];
    for (const document of cases)
      assert.equal((await put(document, { "if-match": before.headers.etag })).status, 400);
    assert.equal(await readFile(documentPath, "utf8"), before.body);
  });
  await t.test("unknown fields are dropped in canonical output", async () => {
    const before = await request();
    assert.equal(
      (await put({ ...empty, future: true }, { "if-match": before.headers.etag })).status,
      200,
    );
    assert.deepEqual(JSON.parse((await request()).body), empty);
  });
  await t.test("malformed and conflicting preconditions return 400", async () => {
    assert.equal((await put(empty, { "if-match": "unquoted" })).status, 400);
    assert.equal((await put(empty, { "if-match": "*", "if-none-match": "*" })).status, 400);
    assert.equal((await put(empty, { "if-none-match": '"other"' })).status, 400);
    assert.equal((await put(empty, { "if-match": '"stale"' })).status, 412);
  });
  await t.test("Host and Origin checks protect the API and static files", async () => {
    assert.equal(
      (await request("GET", "/api/document", { host: `evil.example:${port}` })).status,
      403,
    );
    assert.equal(
      (await request("GET", "/favicon.svg", { host: `evil.example:${port}` })).status,
      403,
    );
    assert.equal(
      (await request("PUT", "/api/document", { "if-match": "*" }, JSON.stringify(empty))).status,
      403,
    );
    for (const invalid of [
      "null",
      "http://evil.example",
      `https://127.0.0.1:${port}`,
      `${origin()}/`,
    ]) {
      assert.equal((await put(empty, { "if-match": "*", origin: invalid })).status, 403);
    }
    assert.equal(
      (
        await put(empty, {
          "if-match": "*",
          host: `localhost:${port}`,
          origin: `http://localhost:${port}`,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("GET", "/api/document")).headers["access-control-allow-origin"],
      undefined,
    );
  });
  await t.test("body limit applies to Content-Length and chunked requests", async () => {
    const before = await request();
    assert.equal(
      (
        await request("PUT", "/api/document", {
          origin: origin(),
          "if-match": "*",
          "content-length": String(16 * 1024 * 1024 + 1),
        })
      ).status,
      413,
    );
    const oversized = "x".repeat(16 * 1024 * 1024 + 1);
    assert.equal(
      (
        await request(
          "PUT",
          "/api/document",
          { origin: origin(), "if-match": "*", "transfer-encoding": "chunked" },
          oversized,
        )
      ).status,
      413,
    );
    assert.equal(await readFile(documentPath, "utf8"), before.body);
  });
  await t.test("static files and unknown routes are handled separately", async () => {
    assert.equal((await request("GET", "/favicon.svg")).status, 200);
    const home = await request("GET", "/");
    const fallback = await request("GET", "/c/nested");
    assert.equal(home.status, 200);
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body, home.body);
    assert.equal((await request("GET", "/missing.js")).status, 404);
    assert.equal((await request("GET", "/%2e%2e/package.json")).status, 400);
    assert.equal((await request("GET", "/api/unknown")).status, 404);
    assert.equal((await request("POST")).status, 405);
  });
  await t.test("deletion fails updates and allows explicit re-creation", async () => {
    const previous = await request();
    await rm(documentPath);
    assert.equal((await put(empty, { "if-match": previous.headers.etag })).status, 412);
    assert.equal((await put(empty, { "if-none-match": "*" })).status, 200);
  });
});

// Transpile the pure client modules so this socket test exercises the shipped commands.
test("structure-generated snapshots are accepted by the local server", async () => {
  const ts = (await import("typescript")).default;
  const { pathToFileURL } = await import("node:url");
  const moduleRoot = path.join(directory, "commands");
  await mkdir(moduleRoot);
  await writeFile(path.join(moduleRoot, "package.json"), '{"type":"module"}');
  for (const source of [
    "client/src/schema.ts",
    "client/src/lib/tree/index.ts",
    "client/src/lib/tree/ops.ts",
    "client/src/lib/tree/navigation.ts",
    "client/src/lib/tree/structure.ts",
    "client/src/lib/editor/graphemes.ts",
  ]) {
    const output = path.join(moduleRoot, source.replace(/\.ts$/, ".js"));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(
      output,
      ts.transpileModule(await readFile(source, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    );
  }
  const load = (relative) => import(pathToFileURL(path.join(moduleRoot, relative)).href);
  const { structureAction } = await load("client/src/lib/tree/structure.js");
  const { applyOp, createContainer } = await load("client/src/lib/tree/ops.js");
  const { buildIndex } = await load("client/src/lib/tree/index.js");
  let schema = JSON.parse(await readFile("fixtures/flat.json", "utf8"));
  let tag = (await request()).headers.etag;
  async function save() {
    const response = await put(schema, { "if-match": tag });
    assert.equal(response.status, 200, response.body);
    tag = response.headers.etag;
    assert.deepEqual(JSON.parse((await request()).body), schema);
    assert.deepEqual(JSON.parse(await readFile(documentPath, "utf8")), schema);
  }
  async function command(id, type, caret = { line: 0, column: 0 }, path = []) {
    const action = structureAction(schema, buildIndex(schema), path, id, caret, type);
    assert.ok(action, `${type} should produce an action`);
    for (const op of action.ops) schema = applyOp(schema, op).schema;
    await save();
    return action;
  }
  await save();
  schema = applyOp(schema, { type: "setText", id: "flat-1-left", text: "日本\n👩‍🚀tail" }).schema;
  const split = await command("flat-1-left", "split", { line: 1, column: 5 });
  await command(split.focus.contentId, "join");
  const sibling = await command("flat-1-right", "newSibling", { line: 0, column: 6 });
  const child = await command(sibling.focus.contentId, "newChild");
  await command(child.focus.contentId, "newChild");
  await command("flat-1-right", "moveDown");
  await command("flat-1-right", "moveUp");
  schema = applyOp(schema, {
    type: "insertContent",
    containerId: "flat-1",
    index: 1,
    content: { id: "extra-left", text: "extra" },
  }).schema;
  await command("extra-left", "moveDown");
  await command("extra-left", "moveUp");
  const emptyRow = createContainer();
  schema = applyOp(schema, {
    type: "insertContainer",
    parentId: null,
    index: schema.root.length,
    container: emptyRow,
  }).schema;
  await command(emptyRow.right.id, "deleteContainer");
});
