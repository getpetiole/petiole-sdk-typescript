// The SDK's types are the public API's: every schema the /v1 routes and the
// webhooks reach, and none that only the platform app's /internal routes
// do. orval.config.ts leaves the latter out by name; this catches a new one
// that its patterns miss, or a public one they catch.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Node = unknown;

// openapi.yaml in the public repository, else the API's own (orval.config.ts).
const local = new URL("../openapi.yaml", import.meta.url);
const SPEC = existsSync(local) ? local : new URL("../../../services/sauron-api/openapi.yaml", import.meta.url);
const spec = parse(await readFile(SPEC, "utf8"));
const generated = await readFile(new URL("../src/generated/model.ts", import.meta.url), "utf8");

function refs(node: Node, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => refs(item, found));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") found.add(value);
      else refs(value, found);
    }
  }
  return found;
}

/** The schemas node reaches, through responses and other schemas. */
function reached(node: Node): Set<string> {
  const schemas = new Set<string>();
  const queue = [...refs(node)];
  while (queue.length) {
    const ref = queue.pop()!;
    const [, section, name] = ref.split("/").slice(1);
    if (!section || !name) continue;
    if (section === "schemas") {
      if (schemas.has(name)) continue;
      schemas.add(name);
    }
    queue.push(...refs(spec.components[section][name]));
  }
  return schemas;
}

const operations = Object.values(spec.paths as Record<string, Record<string, { tags?: string[] }>>).flatMap((path) =>
  Object.values(path),
);
const publicOperations = operations.filter((operation) => !operation.tags?.includes("Platform app"));
const publicSchemas = reached([publicOperations, spec.webhooks]);
const allSchemas = new Set(Object.keys(spec.components.schemas));
const internalSchemas = [...allSchemas].filter((name) => !publicSchemas.has(name));

const exported = (name: string) => new RegExp(`^export (interface|type|const) ${name}\\b`, "m").test(generated);

describe("the generated types", () => {
  it("are every schema the public routes and the webhooks reach", () => {
    expect([...publicSchemas].filter((name) => !exported(name))).toEqual([]);
    expect(publicSchemas.has("AnalysisEvent")).toBe(true);
  });

  it("are none that only the platform app's routes reach", () => {
    // The public repository's spec has none of those routes to check.
    if (operations.length > publicOperations.length) expect(internalSchemas.length).toBeGreaterThan(0);
    expect(internalSchemas.filter(exported)).toEqual([]);
  });
});
