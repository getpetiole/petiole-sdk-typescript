// Every call of the SDK, against Prism's mock of openapi.yaml: a request
// the spec does not allow is refused with a 422 that is not the API's
// problem, and fails here.
import { describe, expect, it } from "vitest";

import { Petiole } from "../../src/index.js";
import { JPEG } from "../fake.js";
import { PRISM_URL } from "./prism.js";

const petiole = new Petiole({ apiKey: "ptl_test_contract", baseUrl: PRISM_URL, maxRetries: 0 });
const ANALYSIS = "ana_01JQ8ZC5T4V7B9K2MNPQRSTWXZ";
const UPLOAD = { uploadId: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ" };
const BOX = { x: 0.12, y: 0.3, width: 0.2, height: 0.18 };

describe("models", () => {
  it("lists, gets and asks the state", async () => {
    expect((await petiole.models.list({ limit: 100 })).object).toBe("list");
    expect(await petiole.models.get("leaf-detector")).toHaveProperty("id");
    expect(await petiole.models.status("leaf-detector")).toHaveProperty("status");
  });

  it("predicts on an image in the request", async () => {
    const prediction = await petiole.models.predict("leaf-detector", JPEG, { confThreshold: 0.25, maxDetections: 10 });
    expect(prediction.object).toBe("prediction");
  });

  it("outlines boxes", async () => {
    expect((await petiole.models.predict("sam2-small", JPEG, { boxes: [BOX] })).object).toBe("prediction");
  });

  it("predicts on an upload", async () => {
    expect((await petiole.models.predict("sam2-small", UPLOAD, { boxes: [BOX] })).object).toBe("prediction");
  });
});

describe("analyses", () => {
  it("are made of an image in the request", async () => {
    const created = await petiole.analyses.create(JPEG, {
      workflow: "leaf_area_v1",
      webhookUrl: "https://example.com/hooks/petiole",
      metadata: { plot: "B4" },
    });
    expect(created.object).toBe("analysis");
  });

  it("are made of an upload", async () => {
    expect((await petiole.analyses.create(UPLOAD, { workflow: "leaf_area_v1", metadata: { plot: "B4" } })).object).toBe("analysis");
  });

  it("are read, listed and deleted", async () => {
    expect(await petiole.analyses.get(ANALYSIS)).toHaveProperty("status");
    expect(await petiole.analyses.result(ANALYSIS)).toHaveProperty("status");
    const page = await petiole.analyses.list({
      workflow: "leaf_area_v1",
      status: "succeeded",
      from: "2026-11-01T00:00:00Z",
      to: "2026-11-08T00:00:00Z",
      limit: 100,
      startingAfter: ANALYSIS,
    });
    expect(page.object).toBe("list");
    expect(await petiole.analyses.delete(ANALYSIS)).toHaveProperty("id");
  });
});

describe("the rest", () => {
  it("uploads, workflows, object types and usage", async () => {
    expect((await petiole.uploads.create({ contentType: "image/jpeg", sizeBytes: 1024 })).object).toBe("upload");
    expect((await petiole.workflows.list({ limit: 10 })).object).toBe("list");
    expect(await petiole.objectTypes.get()).toHaveProperty("version");
    expect(await petiole.usage.get({ from: "2026-10-01", to: "2026-11-08" })).toHaveProperty("days");
  });
});

describe("the mock", () => {
  // Without this, a mock that took anything would pass every test above.
  it("refuses a request the spec does not allow", async () => {
    await expect(petiole.models.predict("leaf-detector", JPEG, { confThreshold: 2 })).rejects.toMatchObject({ status: 422 });
    await expect(petiole.analyses.get("not-an-analysis")).rejects.toMatchObject({ status: 422 });
    await expect(new Petiole({ apiKey: null, baseUrl: PRISM_URL, maxRetries: 0 }).models.list()).rejects.toMatchObject({
      status: 401,
    });
  });
});
