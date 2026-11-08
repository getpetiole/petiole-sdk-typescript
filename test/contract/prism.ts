// Starts Prism's mock of the spec on 127.0.0.1:4011 for the contract tests,
// and stops it after them.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRISM = "@stoplight/prism-cli@5.16.0";
export const PRISM_URL = "http://127.0.0.1:4011";
// openapi.yaml in the public repository, else the API's own (orval.config.ts).
const local = new URL("../../openapi.yaml", import.meta.url);
const SPEC = fileURLToPath(existsSync(local) ? local : new URL("../../../../services/sauron-api/openapi.yaml", import.meta.url));

let prism: ChildProcess | undefined;

export async function setup() {
  prism = spawn("npx", ["--yes", PRISM, "mock", "--host", "127.0.0.1", "--port", "4011", "--cors", "false", SPEC], {
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      // Any answer will do: without a credential Prism's is 401.
      await fetch(`${PRISM_URL}/v1/models`);
      return;
    } catch {
      if (prism.exitCode !== null) throw new Error(`Prism exited with ${prism.exitCode}`);
      if (Date.now() > deadline) throw new Error("Prism did not start in two minutes");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export function teardown() {
  // npx's child is Prism: stop the group.
  if (prism?.pid) process.kill(-prism.pid, "SIGTERM");
}
