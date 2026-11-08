// M7-T13's acceptance: the browser entry has no Node-only import. Walks
// dist/index.js and every module it imports, and fails on any import that
// is not relative: the package has no dependencies, so a bare or node:
// specifier can only be a runtime's own module. Run after `npm run build`.
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPECIFIER = /\b(?:import|export)\s*(?:[^'"`;]*?\bfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const seen = new Set();
const problems = [];
const queue = [resolve(root, "dist/index.js")];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      queue.push(resolve(dirname(file), specifier));
    } else {
      problems.push(`${relative(root, file)} imports ${specifier}`);
    }
  }
}
if (seen.has(resolve(root, "dist/node.js"))) problems.push("dist/index.js reaches dist/node.js");

if (problems.length) {
  console.error(`The browser entry is not runtime-neutral:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`The browser entry imports no Node module: ${seen.size} modules, all relative.`);
