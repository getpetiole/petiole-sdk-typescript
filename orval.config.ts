import { existsSync } from "node:fs";

import { defineConfig } from "orval";

// The SDK's core (M7-T13): generated from the API's spec with
// `npm run generate` into src/generated, and committed; CI fails when it is
// not what openapi.yaml generates. The platform app generates its own client
// from the same spec with the same orval (apps/sauron-web/orval.config.ts),
// so the two never disagree.
//
// The spec is openapi.yaml here in the public repository, which each
// release copies with the public routes only (scripts/export-public.sh),
// else the API's own in Petiole's platform repository.
const SPEC = existsSync("openapi.yaml") ? "openapi.yaml" : "../../services/sauron-api/openapi.yaml";

// Only the public API: the routes tagged "Platform app" (/internal/*) are
// the app's own and are left out. Types, not zod schemas, so the package has
// no runtime dependency; a function for every operation, which calls
// src/transport.ts with the client it is given.
export default defineConfig({
  petiole: {
    input: {
      target: SPEC,
      filters: { mode: "exclude", tags: ["Platform app"], schemas: [/^Me[A-Z]?/, /ApiKey/, /^Organisation/, /Webhook(Info|Secret)|^SetWebhook$/] },
    },
    output: {
      mode: "single",
      target: "src/generated/api.ts",
      schemas: { path: "src/generated/model.ts", mode: "single" },
      client: "fetch",
      httpClient: "fetch",
      baseUrl: "",
      clean: true,
      override: {
        mutator: { path: "src/transport.ts", name: "send" },
        // Each call returns its data; errors are thrown by the transport.
        fetch: { includeHttpResponseReturnType: false },
        // createAnalysis and createPrediction take JSON or a multipart form:
        // a function each.
        splitByContentType: true,
      },
    },
  },
});
