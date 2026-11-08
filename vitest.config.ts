import { defineConfig } from "vitest/config";

// The unit tests, on a fake fetch. The contract tests, against a mock of
// the spec that Prism serves, are vitest.contract.config.ts's.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/contract/**"],
  },
});
