"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

test("npm ci and packing accept a version-only commit without changing the lockfile", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "npm-release-lock-"));
  try {
    const manifest = { name: "@fulcrumapp/release-fixture", version: "1.0.1" };
    const lock = {
      name: manifest.name,
      version: "1.0.0",
      lockfileVersion: 3,
      packages: { "": { name: manifest.name, version: "1.0.0" } }
    };
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
    const install = spawnSync("npm", ["ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"], {
      cwd: dir, encoding: "utf8"
    });
    assert.equal(install.status, 0, install.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "package-lock.json"), "utf8")), lock);
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json"], { cwd: dir, encoding: "utf8" });
    assert.equal(pack.status, 0, pack.stderr);
    const result = JSON.parse(pack.stdout);
    assert.equal(result.length, 1);
    assert.equal(result[0].version, manifest.version);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
