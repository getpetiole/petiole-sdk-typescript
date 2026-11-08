import { describe, expect, it } from "vitest";

import { ApiError, PetioleError, TimeoutError } from "../src/index.js";
import { client, fakeFetch, JPEG, json, problem } from "./fake.js";

const PREDICTION = {
  object: "prediction",
  model: { id: "leaf-detector", version: "leaf-v7-yolo26l" },
  image: { width: 4032, height: 3024 },
  durationMs: 640,
  detections: [{ label: "leaf", classId: 0, score: 0.94, bbox: { x: 0.12, y: 0.3, width: 0.2, height: 0.18 } }],
};

const status = (value: string) => json({ object: "model_status", model: "leaf-detector", status: value, checkedAt: "2026-11-08T12:00:00Z" });

describe("predict", () => {
  it("sends the image in the request, with the options as form fields", async () => {
    const { fetch, requests } = fakeFetch(json(PREDICTION));
    const boxes = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }];
    const prediction = await client(fetch).models.predict("sam2-small", JPEG, { boxes, confThreshold: 0.5 });

    expect(prediction.detections[0]?.label).toBe("leaf");
    const request = requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.test/v1/models/sam2-small/predictions");
    expect(request?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(request?.headers.get("idempotency-key")).toBeTruthy();
    const form = await request!.formData();
    const image = form.get("image") as File;
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPEG);
    expect(JSON.parse(form.get("boxes") as string)).toEqual(boxes);
    expect(form.get("confThreshold")).toBe("0.5");
    expect(form.has("maxDetections")).toBe(false);
  });

  it("predicts on an upload's image as JSON", async () => {
    const { fetch, requests } = fakeFetch(json(PREDICTION));
    await client(fetch).models.predict("leaf-detector", { uploadId: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ" }, { maxDetections: 10 });

    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(await requests[0]?.json()).toEqual({ uploadId: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ", maxDetections: 10 });
  });

  it("waits for a model that is starting, past maxRetries, with the same Idempotency-Key", async () => {
    const starting = problem(503, "model_starting", { "retry-after": "0" });
    const { fetch, requests } = fakeFetch(starting, starting, starting, json(PREDICTION));
    const prediction = await client(fetch, { maxRetries: 0 }).models.predict("leaf-detector", JPEG);

    expect(prediction.model.id).toBe("leaf-detector");
    expect(requests).toHaveLength(4);
    expect(new Set(requests.map((request) => request.headers.get("idempotency-key"))).size).toBe(1);
  });

  it("throws model_starting at once with maxWaitMs 0", async () => {
    const { fetch, left } = fakeFetch(problem(503, "model_starting", { "retry-after": "15" }), json(PREDICTION));
    const error = (await client(fetch).models.predict("leaf-detector", JPEG, { maxWaitMs: 0 }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("model_starting");
    expect(error.retryAfterSeconds).toBe(15);
    expect(left()).toBe(1);
  });

  it("does not retry a model that runs only in its workflows", async () => {
    const { fetch } = fakeFetch(problem(409, "model_not_callable"));
    const error = (await client(fetch).models.predict("leaf-segmenter", JPEG).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("model_not_callable");
  });
});

describe("a model's state", () => {
  it("is asked until it is ready", async () => {
    const { fetch, requests } = fakeFetch(status("starting"), status("starting"), status("ready"));
    const ready = await client(fetch).models.waitUntilReady("leaf-detector", { pollIntervalMs: 1 });
    expect(ready.status).toBe("ready");
    expect(requests.map((request) => request.url)).toEqual(Array(3).fill("https://api.test/v1/models/leaf-detector/status"));
  });

  it("throws when the model is unavailable", async () => {
    const { fetch } = fakeFetch(status("unavailable"));
    await expect(client(fetch).models.waitUntilReady("leaf-detector")).rejects.toThrow(PetioleError);
  });

  it("throws TimeoutError past maxWaitMs", async () => {
    const { fetch } = fakeFetch(status("starting"), status("starting"));
    const waiting = client(fetch).models.waitUntilReady("leaf-detector", { maxWaitMs: 5, pollIntervalMs: 10 });
    await expect(waiting).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("lists", () => {
  it("are iterated page after page", async () => {
    const model = (id: string) => ({ id, object: "model" });
    const { fetch, requests } = fakeFetch(
      json({ object: "list", data: [model("a"), model("b")], hasMore: true }),
      json({ object: "list", data: [model("c")], hasMore: false }),
    );
    const ids: string[] = [];
    for await (const found of client(fetch).models.iterate({ limit: 2 })) ids.push(found.id);

    expect(ids).toEqual(["a", "b", "c"]);
    expect(requests.map((request) => new URL(request.url).search)).toEqual(["?limit=2", "?limit=2&startingAfter=b"]);
  });
});
