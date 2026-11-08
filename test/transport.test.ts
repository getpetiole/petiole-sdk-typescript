import { describe, expect, it } from "vitest";

import { ApiError, ConnectionError, Petiole, PetioleError, TimeoutError, VERSION } from "../src/index.js";
import { retryDelay } from "../src/transport.js";
import { client, fakeFetch, hang, json, problem } from "./fake.js";

const MODELS = { object: "list", data: [], hasMore: false };

describe("the client", () => {
  it("sends the key, asks for JSON, and says who it is", async () => {
    const { fetch, requests } = fakeFetch(json(MODELS));
    await client(fetch).models.list({ limit: 5 });

    const [request] = requests;
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://api.test/v1/models?limit=5");
    expect(request?.headers.get("authorization")).toBe("Bearer ptl_test_secret");
    expect(request?.headers.get("accept")).toContain("application/json");
    expect(request?.headers.get("user-agent")).toMatch(new RegExp(`^petiole-sdk-typescript/${VERSION} node/`));
    expect(request?.headers.has("idempotency-key")).toBe(false);
  });

  it("takes the key and the URL from the environment", async () => {
    const { fetch, requests } = fakeFetch(json(MODELS));
    process.env.PETIOLE_API_KEY = "ptl_test_from_env";
    process.env.PETIOLE_BASE_URL = "https://api-staging.test/";
    try {
      const petiole = new Petiole({ fetch });
      expect(petiole.baseUrl).toBe("https://api-staging.test");
      await petiole.models.list();
    } finally {
      delete process.env.PETIOLE_API_KEY;
      delete process.env.PETIOLE_BASE_URL;
    }
    expect(requests[0]?.url).toBe("https://api-staging.test/v1/models");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer ptl_test_from_env");
  });

  it("refuses to start without a key", () => {
    expect(() => new Petiole({ baseUrl: "https://api.test" })).toThrow(/PETIOLE_API_KEY/);
  });

  it("sends no key when told to, for a proxy that adds it", async () => {
    const { fetch, requests } = fakeFetch(json(MODELS));
    await new Petiole({ apiKey: null, baseUrl: "https://example.test/api/", fetch }).models.list();
    expect(requests[0]?.url).toBe("https://example.test/api/v1/models");
    expect(requests[0]?.headers.has("authorization")).toBe(false);
  });

  it("keeps the version package.json says", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(manifest.version);
  });
});

describe("errors", () => {
  it("are the API's problem, in words with the request's id", async () => {
    const { fetch } = fakeFetch(
      problem(422, "invalid_request", {}, { title: "Invalid request", detail: "The body is not valid.", errors: [{ detail: "Required", pointer: "/workflow" }] }),
    );
    const error = await client(fetch).models.get("leaf-detector").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(PetioleError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe("invalid_request");
    expect(apiError.requestId).toBe("req_01JQ8ZC5T4V7B9K2MNPQRSTWXZ");
    expect(apiError.errors).toEqual([{ detail: "Required", pointer: "/workflow" }]);
    expect(apiError.message).toBe(
      "Invalid request: The body is not valid. (/workflow: Required) [invalid_request, request req_01JQ8ZC5T4V7B9K2MNPQRSTWXZ]",
    );
  });

  it("from something in front of the API are unexpected_response, with its status", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = (await client(fetch, { maxRetries: 0 }).models.list().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("unexpected_response");
    expect(error.status).toBe(502);
  });
});

describe("retries", () => {
  it("retry what may pass, with one Idempotency-Key for every attempt of a POST", async () => {
    const { fetch, requests } = fakeFetch(
      problem(503, "service_unavailable", { "retry-after": "0" }),
      problem(429, "rate_limited", { "retry-after": "0" }),
      json({ id: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ", object: "upload", url: "https://bucket.test/x", headers: {}, expiresAt: "2026-11-08T13:00:00Z" }, 201),
    );
    const upload = await client(fetch).uploads.create({ contentType: "image/jpeg", sizeBytes: 10 });

    expect(upload.id).toBe("upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ");
    const keys = requests.map((request) => request.headers.get("idempotency-key"));
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(keys).size).toBe(1);
  });

  it("use the Idempotency-Key the caller gives", async () => {
    const { fetch, requests } = fakeFetch(json({}, 201));
    await client(fetch).uploads.create({ contentType: "image/jpeg", sizeBytes: 10 }, { idempotencyKey: "mine" });
    expect(requests[0]?.headers.get("idempotency-key")).toBe("mine");
  });

  it("never retry a quota", async () => {
    const { fetch, left } = fakeFetch(problem(429, "quota_exceeded", { "retry-after": "3600" }), json(MODELS));
    const error = (await client(fetch).models.list().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("quota_exceeded");
    expect(error.retryAfterSeconds).toBe(3600);
    expect(left()).toBe(1);
  });

  it("stop at maxRetries", async () => {
    const { fetch, left } = fakeFetch(
      problem(500, "internal_error"),
      problem(500, "internal_error"),
      json(MODELS),
    );
    const error = (await client(fetch, { maxRetries: 1 }).models.list().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("internal_error");
    expect(left()).toBe(1);
  });

  it("retry a connection that failed, then say so", async () => {
    const refused: () => never = () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    };
    const { fetch, requests } = fakeFetch(refused, refused);
    const error = await client(fetch, { maxRetries: 1 }).models.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toContain("ECONNREFUSED");
    expect(requests).toHaveLength(2);
  });

  it("give an attempt timeoutMs", async () => {
    const { fetch } = fakeFetch(hang());
    const error = await client(fetch, { maxRetries: 0, timeoutMs: 20 }).models.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it("stop when the caller aborts, with its reason", async () => {
    const { fetch, requests } = fakeFetch(hang(), json(MODELS));
    const controller = new AbortController();
    const reason = new Error("the user left");
    setTimeout(() => controller.abort(reason), 10);
    const error = await client(fetch).models.list({}, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBe(reason);
    expect(requests).toHaveLength(1);
  });

  describe("retryDelay", () => {
    const error = (status: number, code: string, retryAfterSeconds?: number) =>
      new ApiError(status, { type: "", title: "", status, code, requestId: "req_1" }, undefined, retryAfterSeconds);

    it("waits for a model that is starting until its deadline, whatever maxRetries says", () => {
      const now = 1_000_000;
      expect(retryDelay(error(503, "model_starting", 15), 5, 0, now + 60_000, now)).toBe(15_000);
      expect(retryDelay(error(503, "model_starting", 15), 5, 0, now + 4_000, now)).toBe(4_000);
      expect(retryDelay(error(503, "model_starting", 15), 0, 2, now, now)).toBeUndefined();
    });

    it("follows Retry-After, but not past a minute", () => {
      expect(retryDelay(error(429, "rate_limited", 7), 0, 2)).toBe(7_000);
      expect(retryDelay(error(429, "rate_limited", 120), 0, 2)).toBeUndefined();
    });

    it("backs off without one", () => {
      const first = retryDelay(error(500, "internal_error"), 0, 2) ?? 0;
      const second = retryDelay(error(500, "internal_error"), 1, 2) ?? 0;
      expect(first).toBeGreaterThanOrEqual(375);
      expect(first).toBeLessThanOrEqual(625);
      expect(second).toBeGreaterThanOrEqual(750);
      expect(second).toBeLessThanOrEqual(1250);
    });

    it("does not retry what a retry does not change", () => {
      expect(retryDelay(error(404, "not_found"), 0, 2)).toBeUndefined();
      expect(retryDelay(error(409, "model_not_callable"), 0, 2)).toBeUndefined();
      expect(retryDelay(error(429, "concurrency_limit_exceeded", 1), 0, 2)).toBeUndefined();
    });
  });
});
