#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "test", "scripts", "public"];
const files = roots.flatMap((root) => findJavaScriptFiles(root));
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exitCode = 1;

function findJavaScriptFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith(".js") ? [path] : [];

  const files = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const childStat = statSync(child);
    if (childStat.isDirectory()) {
      files.push(...findJavaScriptFiles(child));
    } else if (entry.endsWith(".js")) {
      files.push(child);
    }
  }
  return files;
}
