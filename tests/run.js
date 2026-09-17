// A tiny, dependency-free test runner. Run with `npm test` or
// `node tests/run.js`. Loads every tests/*.test.js file (each registers
// its cases via tests/helpers.js's `test()`), then executes them all.
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { registry } from "./helpers.js";

const dir = path.dirname(new URL(import.meta.url).pathname);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
for (const file of files) await import(pathToFileURL(path.join(dir, file)).href);

let passed = 0;
const failures = [];
for (const { name, fn } of registry) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

console.log(`\n${passed} passed, ${failures.length} failed (${registry.length} total, from ${files.length} files)`);
for (const f of failures) {
  console.log(`\nFAIL: ${f.name}`);
  console.log(f.err.message);
}
if (failures.length) process.exit(1);
