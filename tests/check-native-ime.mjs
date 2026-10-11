import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const rows = readFileSync("docs/ime-checks.md", "utf8")
  .split("\n")
  .filter((line) => /^\| (macOS|Windows) \|/.test(line))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
assert.equal(rows.length, 3, "Record all three native IME environments");
for (const row of rows) {
  const environment = row.slice(0, 3).join(" / ");
  assert.ok(row[3] && row[3] !== "Pending", environment + ": browser version is missing");
  assert.match(row[4], /^\d{4}-\d{2}-\d{2}$/, environment + ": date is missing");
  assert.match(row[5], /^[a-f0-9]{40}$/, environment + ": record the full tested commit hash");
  execFileSync("git", ["merge-base", "--is-ancestor", row[5], commit]);
  const changes = execFileSync("git", ["diff", row[5], "--", ".", ":(exclude)docs/ime-checks.md"], { encoding: "utf8" });
  assert.equal(changes, "", environment + ": project changed since native IME validation");
  assert.equal(row[6], "Pass", environment + ": all six checks must pass");
}
console.log("Native IME release evidence matches " + commit);
