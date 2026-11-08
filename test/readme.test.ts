// The README's quickstart is examples/quickstart.mjs, which ran against
// staging (M7-T13's acceptance): the two stay the same code.
import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("the README's quickstart is examples/quickstart.mjs", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const example = await readFile(new URL("../examples/quickstart.mjs", import.meta.url), "utf8");
  const block = readme.match(/```js\n(import \{ Petiole \}[\s\S]*?)```/)?.[1];
  expect(block).toBe(example.slice(example.indexOf("import { Petiole }")));
});
