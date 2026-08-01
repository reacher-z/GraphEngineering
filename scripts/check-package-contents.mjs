#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "packages");
const forbiddenPath = /(?:^|\/)(?:node_modules|tests?|coverage|codex_logs|codex_plans)(?:\/|$)|(?:^|\/)\.env(?:\.|$)/u;
const maxUnpackedSizeByPackage = new Map([
  // SQLite carries the complete v1/v2 migration catalog and the package-private
  // cursor publication proof machinery. Keep its exception explicit and
  // bounded instead of weakening the default guard for every package.
  ["@graph-engineering/sqlite", 2_500_000],
]);

function publicEntryPaths(manifest) {
  const paths = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      paths.add(value.replace(/^\.\//u, ""));
    } else if (value !== null && typeof value === "object") {
      for (const nested of Object.values(value)) visit(nested);
    }
  };
  visit(manifest.main);
  visit(manifest.types);
  visit(manifest.exports);
  visit(manifest.bin);
  return paths;
}

const workspaceManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(workspaceManifest.private, true, "workspace root must remain private");
const workspacePack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
assert.equal(
  workspacePack.status,
  0,
  `workspace root npm pack failed\n${workspacePack.stderr || workspacePack.stdout}`,
);
const workspaceReports = JSON.parse(workspacePack.stdout);
assert.equal(workspaceReports.length, 1, "workspace root must produce one dry-run report");
assert.deepEqual(
  workspaceReports[0].files.map((file) => file.path).sort(),
  ["LICENSE", "README.md", "package.json"],
  "private workspace tarball leaked repository-only files",
);
process.stdout.write("Private workspace tarball leak guard passed.\n");

const entries = await readdir(packageRoot, { withFileTypes: true });
const directories = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let checked = 0;
const versions = new Set();
for (const directory of directories) {
  const cwd = join(packageRoot, directory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (manifest.private === true) continue;

  assert.match(manifest.name ?? "", /^@graph-engineering\/[a-z0-9-]+$/u, `${directory}: invalid package name`);
  assert.match(manifest.version ?? "", /^0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, `${directory}: invalid version`);
  assert.equal(manifest.license, "MIT", `${directory}: package license must be MIT`);
  assert.ok(typeof manifest.description === "string" && manifest.description.length > 0, `${directory}: description missing`);
  assert.ok(typeof manifest.engines?.node === "string", `${directory}: Node engine missing`);
  assert.equal(
    manifest.repository?.url,
    "git+https://github.com/reacher-z/GraphEngineering.git",
    `${directory}: repository URL is missing or inconsistent`,
  );
  assert.equal(
    manifest.repository?.directory,
    `packages/${directory}`,
    `${directory}: repository directory is missing or inconsistent`,
  );
  assert.equal(
    manifest.homepage,
    "https://github.com/reacher-z/GraphEngineering#readme",
    `${directory}: homepage is missing or inconsistent`,
  );
  assert.equal(
    manifest.bugs?.url,
    "https://github.com/reacher-z/GraphEngineering/issues",
    `${directory}: bugs URL is missing or inconsistent`,
  );
  assert.equal(manifest.publishConfig?.access, "public", `${directory}: scoped package must publish publicly`);
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length >= 5, `${directory}: discovery keywords missing`);
  versions.add(manifest.version);

  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(packed.status, 0, `${manifest.name}: npm pack failed\n${packed.stderr || packed.stdout}`);
  const reports = JSON.parse(packed.stdout);
  assert.equal(reports.length, 1, `${manifest.name}: expected one pack report`);
  const report = reports[0];
  const files = new Map(report.files.map((file) => [file.path, file]));

  assert.ok(files.has("package.json"), `${manifest.name}: tarball omits package.json`);
  assert.ok(files.has("README.md"), `${manifest.name}: tarball omits README.md`);
  assert.ok(files.has("LICENSE"), `${manifest.name}: tarball omits MIT license text`);
  const maxUnpackedSize = maxUnpackedSizeByPackage.get(manifest.name) ?? 2_000_000;
  assert.ok(
    report.unpackedSize > 0 && report.unpackedSize <= maxUnpackedSize,
    `${manifest.name}: unexpected unpacked size`,
  );
  for (const path of files.keys()) {
    assert.equal(forbiddenPath.test(path), false, `${manifest.name}: forbidden tarball path ${path}`);
    assert.equal(path.endsWith(".ts") && !path.endsWith(".d.ts"), false, `${manifest.name}: source TypeScript leaked: ${path}`);
  }
  for (const path of publicEntryPaths(manifest)) {
    assert.ok(files.has(path), `${manifest.name}: public entry '${path}' is absent from tarball`);
  }
  for (const path of Object.values(manifest.bin ?? {})) {
    const normalized = path.replace(/^\.\//u, "");
    const mode = files.get(normalized)?.mode ?? 0;
    assert.ok((mode & 0o111) !== 0, `${manifest.name}: bin '${normalized}' is not executable`);
  }

  checked += 1;
  process.stdout.write(`Package contents passed: ${manifest.name}@${manifest.version} (${report.entryCount} files).\n`);
}

assert.ok(checked > 0, "no public packages were checked");
assert.equal(versions.size, 1, `public npm packages have divergent versions: ${[...versions].join(", ")}`);
process.stdout.write(`Validated ${checked} npm package manifests and dry-run tarballs.\n`);
