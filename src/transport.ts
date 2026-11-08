// The one fetch behind the generated core (src/generated/api.ts, whose
// every function calls send with the init it is given): the key, the base
// URL, a timeout per attempt, retries of what may pass, and an
// Idempotency-Key on every POST, the same on each of its retries, so a
// retry never makes a second analysis or counts a second prediction (the
// API keeps a key's answer only once it succeeds).
import { ApiError, ConnectionError, PetioleError, TimeoutError, UploadError } from "./errors.js";
import { nodeVersion, sleep, uuid } from "./internal.js";
import { VERSION } from "./version.js";

/** What every call takes, last among its arguments. */
export interface RequestOptions {
  /** Cancels the call, its retries and its waits; it rejects with the
   * signal's reason. */
  signal?: AbortSignal;
  /** How long one attempt may take, in milliseconds; the client's
   * `timeoutMs` by default. */
  timeoutMs?: number;
  /** How many times to retry a failure that may pass; the client's
   * `maxRetries` by default. */
  maxRetries?: number;
  /** A POST's Idempotency-Key. One is made for every call that has none,
   * and kept across its retries; give your own to make a call safe to
   * repeat yourself, such as after a crash, for 24 hours. */
  idempotencyKey?: string;
  /** More headers for this call. */
  headers?: Record<string, string>;
}

export interface TransportConfig {
  apiKey: string | undefined;
  baseUrl: string;
  fetch: typeof fetch | undefined;
  timeoutMs: number;
  maxRetries: number;
  headers: Record<string, string>;
}

/** The init the generated functions hand send: a RequestInit, with the
 * client's transport and the call's options. */
export type SendInit = RequestInit & {
  transport?: Transport;
  request?: RequestOptions;
  /** For a prediction: until when, in ms since the epoch, a model that is
   * starting is waited for. */
  modelStartingUntil?: number;
};

/** The mutator of orval.config.ts. */
export async function send<T>(url: string, init: SendInit): Promise<T> {
  const { transport, ...rest } = init;
  if (!transport) throw new PetioleError(`${url} was called without a client: call it through a Petiole.`);
  return transport.request<T>(url, rest);
}

// Codes, and statuses without a problem, that may pass on their own. A
// quota or the concurrent cap does not pass in seconds and is the caller's
// to handle; model_starting is waited out by a prediction, up to its budget.
const RETRIED_CODES = new Set([
  "rate_limited",
  "idempotency_key_in_use",
  "internal_error",
  "service_unavailable",
  "model_starting",
]);
const RETRIED_STATUSES = new Set([408, 502, 503, 504]);
const NEVER_RETRIED = new Set(["quota_exceeded", "concurrency_limit_exceeded"]);
// A Retry-After longer than this is not waited for, but thrown.
const LONGEST_RETRY_AFTER_MS = 60_000;
// A model that is starting when the API gives no Retry-After.
const MODEL_STARTING_WAIT_MS = 15_000;
// An upload's PUT may carry 20 MiB from a phone.
const LEAST_UPLOAD_TIMEOUT_MS = 300_000;

/** How long to wait before retrying error after attempt (from 0), or
 * undefined to throw it. */
export function retryDelay(
  error: ApiError,
  attempt: number,
  maxRetries: number,
  modelStartingUntil?: number,
  now = Date.now(),
): number | undefined {
  if (error.code === "model_starting" && modelStartingUntil !== undefined) {
    const left = modelStartingUntil - now;
    if (left <= 0) return undefined;
    return Math.min((error.retryAfterSeconds ?? MODEL_STARTING_WAIT_MS / 1000) * 1000, left);
  }
  if (attempt >= maxRetries || NEVER_RETRIED.has(error.code)) return undefined;
  const retried = RETRIED_CODES.has(error.code) || (error.code === "unexpected_response" && RETRIED_STATUSES.has(error.status));
  if (!retried) return undefined;
  if (error.retryAfterSeconds !== undefined) {
    const wait = error.retryAfterSeconds * 1000;
    return wait <= LONGEST_RETRY_AFTER_MS ? wait : undefined;
  }
  return backoff(attempt);
}

/** 0.5 s doubling to 8 s, give or take a quarter. */
function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}

interface Answer {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

export class Transport {
  readonly config: TransportConfig;
  private readonly userAgent: string | undefined;

  constructor(config: TransportConfig) {
    this.config = config;
    // A browser sends its own, and refuses to be told otherwise.
    if (typeof document === "undefined") {
      const node = nodeVersion();
      this.userAgent = `petiole-sdk-typescript/${VERSION}${node ? ` node/${node}` : ""}`;
    }
  }

  /** The init a generated function takes for a call with options. */
  init(options?: RequestOptions): SendInit {
    return { transport: this, request: options };
  }

  /** A call of the API: path, such as /v1/models, and its init. */
  async request<T>(path: string, init: Omit<SendInit, "transport">): Promise<T> {
    const { request = {}, modelStartingUntil, ...fetchInit } = init;
    const method = (fetchInit.method ?? "GET").toUpperCase();
    const headers = new Headers(this.config.headers);
    new Headers(fetchInit.headers).forEach((value, name) => headers.set(name, value));
    for (const [name, value] of Object.entries(request.headers ?? {})) headers.set(name, value);
    headers.set("accept", "application/json, application/problem+json");
    if (this.config.apiKey) headers.set("authorization", `Bearer ${this.config.apiKey}`);
    if (this.userAgent) headers.set("user-agent", this.userAgent);
    if (method === "POST" && !headers.has("idempotency-key")) {
      headers.set("idempotency-key", request.idempotencyKey ?? uuid());
    }

    const url = this.config.baseUrl + path;
    const maxRetries = request.maxRetries ?? this.config.maxRetries;
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
    for (let attempt = 0; ; attempt++) {
      let answer: Answer;
      try {
        answer = await this.attempt(url, { ...fetchInit, method, headers }, timeoutMs, request.signal);
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason;
        if (attempt < maxRetries) {
          await sleep(backoff(attempt), request.signal);
          continue;
        }
        throw error;
      }
      if (answer.ok) return parse<T>(answer, method, path);
      const error = ApiError.of(answer.status, answer.headers, answer.text);
      const delay = retryDelay(error, attempt, maxRetries, modelStartingUntil);
      if (delay === undefined) throw error;
      await sleep(delay, request.signal);
    }
  }

  /** A PUT of body to an upload's signed URL, with exactly its headers:
   * neither the key nor the base URL, since it goes to the bucket. */
  async put(url: string, headers: Record<string, string>, body: Blob, request: RequestOptions = {}): Promise<void> {
    const maxRetries = request.maxRetries ?? this.config.maxRetries;
    const timeoutMs = request.timeoutMs ?? Math.max(this.config.timeoutMs, LEAST_UPLOAD_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      let answer: Answer | undefined;
      let failure: unknown;
      try {
        answer = await this.attempt(url, { method: "PUT", headers, body }, timeoutMs, request.signal);
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason;
        failure = error;
      }
      if (answer?.ok) return;
      const transient = !answer || answer.status === 408 || answer.status === 429 || answer.status >= 500;
      if (transient && attempt < maxRetries) {
        await sleep(backoff(attempt), request.signal);
        continue;
      }
      if (!answer) throw failure;
      throw new UploadError(
        `The upload's PUT was refused with ${answer.status}${answer.text ? `: ${answer.text.slice(0, 300)}` : ""}`,
        answer.status,
      );
    }
  }

  /** One attempt: the response and its body, read within timeoutMs.
   * Throws TimeoutError or ConnectionError, or the signal's reason. */
  private async attempt(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Answer> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const fetchInit = { ...init, signal: controller.signal };
      // The global fetch is called as globalThis's, as browsers require.
      const response = await (this.config.fetch ? this.config.fetch(url, fetchInit) : fetch(url, fetchInit));
      const text = await response.text();
      return { status: response.status, ok: response.ok, headers: response.headers, text };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timedOut) throw new TimeoutError(`No answer from ${redact(url)} in ${timeoutMs} ms.`);
      throw new ConnectionError(`Could not reach ${redact(url)}: ${messageOf(error)}`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function parse<T>(answer: Answer, method: string, path: string): T {
  if (answer.status === 204 || answer.status === 205 || !answer.text) return undefined as T;
  try {
    return JSON.parse(answer.text) as T;
  } catch {
    const requestId = answer.headers.get("request-id");
    throw new PetioleError(
      `${method} ${path} answered ${answer.status} with a body that is not JSON${requestId ? ` [request ${requestId}]` : ""}.`,
    );
  }
}

/** A URL without its query, which for a signed URL is its signature. */
function redact(url: string): string {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}
