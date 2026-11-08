import { describe, expect, it } from "vitest";

import { AnalysisFailedError, TimeoutError } from "../src/index.js";
import { analysis, ANALYSIS_ID, client, fakeFetch, JPEG, json } from "./fake.js";

const CREATED = {
  id: ANALYSIS_ID,
  object: "analysis",
  workflow: "leaf_area_v1",
  status: "queued",
  createdAt: "2026-11-08T12:00:00Z",
  links: { self: `/v1/analyses/${ANALYSIS_ID}`, result: `/v1/analyses/${ANALYSIS_ID}/result` },
};

const outcome = (status: string, extra = {}) =>
  json({ id: ANALYSIS_ID, object: "analysis_result", status, code: null, reason: null, result: null, artifacts: null, ...extra });

const MANIFEST = {
  payloadKind: "object_list",
  payloadVersion: 1,
  jobId: ANALYSIS_ID,
  processorKey: "leaf_area",
  algorithmVersion: "1.0.0",
  objectTypesRegistryVersion: 1,
  objects: [{ objectType: "leaf", objectTypeVersion: 2, objectId: "leaf-1", properties: { area_cm2: 42.7 } }],
};

describe("analyze", () => {
  it("sends the image, waits until the analysis has ended, and answers its result", async () => {
    const { fetch, requests } = fakeFetch(
      json(CREATED, 202),
      json(analysis("running", false)),
      json(analysis("succeeded", true)),
      outcome("succeeded", { result: MANIFEST, artifacts: {} }),
    );
    const seen: string[] = [];
    const result = await client(fetch).analyze(JPEG, {
      workflow: "leaf_area_v1",
      metadata: { plot: "B4" },
      pollIntervalMs: 1,
      onStatus: (each) => seen.push(each.status),
    });

    expect(result.status).toBe("succeeded");
    expect(result.result?.objects[0]?.properties).toEqual({ area_cm2: 42.7 });
    expect(seen).toEqual(["running", "succeeded"]);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /v1/analyses",
      `GET /v1/analyses/${ANALYSIS_ID}`,
      `GET /v1/analyses/${ANALYSIS_ID}`,
      `GET /v1/analyses/${ANALYSIS_ID}/result`,
    ]);
    const form = await requests[0]!.formData();
    expect(form.get("workflow")).toBe("leaf_area_v1");
    expect(JSON.parse(form.get("metadata") as string)).toEqual({ plot: "B4" });
    expect(form.has("webhookUrl")).toBe(false);
  });

  it("answers a cancelled analysis as an outcome, with its code", async () => {
    const { fetch } = fakeFetch(
      json(CREATED, 202),
      json(analysis("cancelled", true, { code: "no_markers" })),
      outcome("cancelled", { code: "no_markers", reason: "No calibration pad was found." }),
    );
    const result = await client(fetch).analyze(JPEG, { workflow: "leaf_area_v1" });
    expect(result.status).toBe("cancelled");
    expect(result.code).toBe("no_markers");
  });

  it("throws AnalysisFailedError for a failed one", async () => {
    const { fetch } = fakeFetch(
      json(CREATED, 202),
      json(analysis("failed", true, { code: "model_unavailable" })),
      outcome("failed", { code: "model_unavailable", reason: "A model did not answer." }),
    );
    const error = await client(fetch).analyze(JPEG, { workflow: "leaf_area_v1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalysisFailedError);
    expect((error as AnalysisFailedError).code).toBe("model_unavailable");
    expect((error as Error).message).toBe(`Analysis ${ANALYSIS_ID} failed: A model did not answer. (model_unavailable).`);
  });

  it("waits through a failed attempt that is retried", async () => {
    const { fetch } = fakeFetch(
      json(CREATED, 202),
      json(analysis("failed", false, { code: "internal_error" })),
      json(analysis("succeeded", true)),
      outcome("succeeded", { result: MANIFEST }),
    );
    const result = await client(fetch).analyze(JPEG, { workflow: "leaf_area_v1", pollIntervalMs: 1 });
    expect(result.status).toBe("succeeded");
  });
});

describe("analyses", () => {
  it("are made of an upload's image as JSON", async () => {
    const { fetch, requests } = fakeFetch(json(CREATED, 202));
    await client(fetch).analyses.create(
      { uploadId: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ" },
      { workflow: "leaf_area_v1", webhookUrl: "https://example.com/hooks/petiole" },
    );
    expect(await requests[0]?.json()).toEqual({
      uploadId: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ",
      workflow: "leaf_area_v1",
      webhookUrl: "https://example.com/hooks/petiole",
    });
  });

  it("are waited for no longer than maxWaitMs", async () => {
    const { fetch } = fakeFetch(json(analysis("running", false)));
    await expect(client(fetch).analyses.wait(ANALYSIS_ID, { maxWaitMs: 0 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it("are listed with their filters, and deleted", async () => {
    const { fetch, requests } = fakeFetch(
      json({ object: "list", data: [], hasMore: false }),
      json({ id: ANALYSIS_ID, object: "analysis", deleted: true }, 202),
    );
    const petiole = client(fetch);
    await petiole.analyses.list({ workflow: "leaf_area_v1", status: "succeeded", limit: 100 });
    await petiole.analyses.delete(ANALYSIS_ID);
    expect(requests[0]?.url).toBe("https://api.test/v1/analyses?workflow=leaf_area_v1&status=succeeded&limit=100");
    expect(`${requests[1]?.method} ${requests[1]?.url}`).toBe(`DELETE https://api.test/v1/analyses/${ANALYSIS_ID}`);
  });
});
