import { defineConfig } from "vitest/config";

// The contract tests: every call of the SDK against a mock of the API that
// Prism serves from openapi.yaml, which refuses a request the spec does not
// allow, so the SDK sends what the spec says (as the platform app's smoke
// tests do, apps/sauron-web/playwright.config.ts). Prism needs Node 24.
export default defineConfig({
  test: {
    include: ["test/contract/**/*.test.ts"],
    globalSetup: ["test/contract/prism.ts"],
    testTimeout: 30_000,
  },
});
