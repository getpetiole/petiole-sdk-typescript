// A fetch that answers from a list, one answer per call, and keeps a copy
// of every request it was sent.
import { Petiole, type PetioleOptions } from "../src/index.js";

export type Answer = (request: Request) => Response | Promise<Response>;

export function fakeFetch(...answers: Answer[]) {
  const requests: Request[] = [];
  const queue = [...answers];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request.clone());
    const answer = queue.shift();
    if (!answer) throw new Error(`No answer left for ${request.method} ${request.url}`);
    return answer(request);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests, left: () => queue.length };
}

export function client(fetch: typeof globalThis.fetch, options: PetioleOptions = {}): Petiole {
  return new Petiole({ apiKey: "ptl_test_secret", baseUrl: "https://api.test", fetch, ...options });
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Answer {
  return () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function problem(status: number, code: string, headers: Record<string, string> = {}, extra = {}): Answer {
  return () =>
    new Response(
      JSON.stringify({
        type: `https://docs.petiole.pro/errors/${code}`,
        title: "What it means",
        status,
        code,
        detail: "What went wrong.",
        requestId: "req_01JQ8ZC5T4V7B9K2MNPQRSTWXZ",
        ...extra,
      }),
      { status, headers: { "content-type": "application/problem+json", ...headers } },
    );
}

/** An answer that never comes: it rejects once the request is aborted. */
export function hang(): Answer {
  return (request) =>
    new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason)));
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);

export const ANALYSIS_ID = "ana_01JQ8ZC5T4V7B9K2MNPQRSTWXZ";

export function analysis(status: string, final: boolean, extra = {}) {
  return {
    id: ANALYSIS_ID,
    object: "analysis",
    workflow: "leaf_area_v1",
    apiKeyId: "key_01JQ8ZC5T4V7B9K2MNPQRSTWXZ",
    userId: null,
    metadata: null,
    status,
    final,
    step: null,
    code: null,
    reason: null,
    attempt: 1,
    maxAttempts: 3,
    fingerprint: "",
    queuedAt: null,
    startedAt: null,
    updatedAt: "2026-11-08T12:00:00Z",
    finishedAt: null,
    result: null,
    timeline: [],
    stepDurationsMs: null,
    ...extra,
  };
}
