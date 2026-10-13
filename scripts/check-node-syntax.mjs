#!/usr/bin/env node
// Runs `node --check` over every main-process/script/test module so syntax
// errors in code the TypeScript build never sees are caught before runtime.
// Reports every failing file, then exits non-zero if any failed.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["electron", "packages", "scripts", "tests"];
const skippedDirectories = new Set(["node_modules"]);
const checkedExtensions = new Set([".mjs", ".cjs"]);

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile() && checkedExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
};

const checkFile = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => resolve({ file, ok: false, output: String(error) }));
    child.on("close", (code) => resolve({ file, ok: code === 0, output: stderr.trim() }));
  });

const runPool = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
};

const files = (await Promise.all(roots.map((root) => collectFiles(path.join(repoRoot, root)))))
  .flat()
  .sort();

if (files.length === 0) {
  console.error("check-node-syntax: no .mjs/.cjs files found; is the script in the right place?");
  process.exit(1);
}

const results = await runPool(files, Math.max(1, availableParallelism() - 1), checkFile);
const failures = results.filter((result) => !result.ok);

for (const failure of failures) {
  console.error(`\nSyntax check failed: ${path.relative(repoRoot, failure.file)}`);
  if (failure.output) console.error(failure.output);
}

if (failures.length > 0) {
  console.error(`\ncheck-node-syntax: ${failures.length} of ${files.length} file(s) failed.`);
  process.exit(1);
}

console.log(`check-node-syntax: ${files.length} file(s) OK.`);
