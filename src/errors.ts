import type { AnalysisResult, Problem, ProblemError } from "./generated/model.js";

/** Every error this package throws, but a call's own abort, which rejects
 * with the signal's reason. */
export class PetioleError extends Error {
  override name = "PetioleError";
}

/**
 * The API answered with an error: a problem (RFC 9457) with its `code`,
 * which stays the same when the wording changes, and the request's id to
 * quote when asking about it.
 *
 * Codes grow: one this package does not know goes by its `status`.
 * `quota_exceeded` and `concurrency_limit_exceeded` are limits of the
 * organisation, never retried; `model_starting` is a model waking, which a
 * prediction waits out (see `PredictOptions.maxWaitMs`).
 */
export class ApiError extends PetioleError {
  override name = "ApiError";
  /** The HTTP status. */
  readonly status: number;
  /** The problem's code, such as `not_found`; `unexpected_response` when the
   * answer was not a problem, as from a proxy in between. */
  readonly code: string;
  /** What the code means, in words. */
  readonly title: string | undefined;
  /** What went wrong with this request. */
  readonly detail: string | undefined;
  /** The request's id, `req_…`: quote it. */
  readonly requestId: string | undefined;
  /** With `invalid_request`: every reason the request is not valid. */
  readonly errors: ProblemError[];
  /** Seconds to wait before trying again, from `Retry-After`. */
  readonly retryAfterSeconds: number | undefined;
  /** The problem as the API sent it, when it sent one. */
  readonly problem: Problem | undefined;

  constructor(status: number, problem: Problem | undefined, requestId: string | undefined, retryAfterSeconds?: number) {
    const code = problem?.code ?? "unexpected_response";
    const id = problem?.requestId ?? requestId;
    super(describe(status, code, problem, id));
    this.status = status;
    this.code = code;
    this.title = problem?.title;
    this.detail = problem?.detail;
    this.requestId = id;
    this.errors = problem?.errors ?? [];
    this.retryAfterSeconds = retryAfterSeconds;
    this.problem = problem;
  }

  /** The error of a response that is not ok, from its status, headers and
   * body as text. */
  static of(status: number, headers: Headers, text: string): ApiError {
    return new ApiError(
      status,
      problemOf(text),
      headers.get("request-id") ?? undefined,
      retryAfter(headers.get("retry-after")),
    );
  }
}

/** The API could not be reached: no answer at all, such as a DNS failure, a
 * refused connection or a dropped one. */
export class ConnectionError extends PetioleError {
  override name = "ConnectionError";
}

/** A request, or a wait, took longer than it was given. */
export class TimeoutError extends PetioleError {
  override name = "TimeoutError";
}

/** The PUT of an image to an upload's signed URL failed. */
export class UploadError extends PetioleError {
  override name = "UploadError";
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * An analysis ended `failed`: a technical failure, after its retries.
 * A `cancelled` analysis is not an error but an outcome, such as a photo
 * without the calibration pad, and is returned like a success.
 */
export class AnalysisFailedError extends PetioleError {
  override name = "AnalysisFailedError";
  readonly analysisId: string;
  readonly code: string | null;
  readonly reason: string | null;
  readonly result: AnalysisResult;

  constructor(result: AnalysisResult) {
    super(`Analysis ${result.id} failed: ${result.reason ?? "no reason was given"}${result.code ? ` (${result.code})` : ""}.`);
    this.analysisId = result.id;
    this.code = result.code;
    this.reason = result.reason;
    this.result = result;
  }
}

/** A webhook's signature did not verify: refuse the request. */
export class WebhookSignatureError extends PetioleError {
  override name = "WebhookSignatureError";
}

function describe(status: number, code: string, problem: Problem | undefined, requestId: string | undefined): string {
  let text = problem?.title ?? `The API answered ${status}`;
  if (problem?.detail) text += `: ${problem.detail}`;
  const reasons = (problem?.errors ?? []).map((error) => {
    const where = error.pointer ?? error.parameter;
    return where ? `${where}: ${error.detail}` : error.detail;
  });
  if (reasons.length) text += ` (${reasons.join("; ")})`;
  return `${text} [${code}${requestId ? `, request ${requestId}` : ""}]`;
}

function problemOf(text: string): Problem | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string") {
      return value as Problem;
    }
  } catch {
    // Not JSON: an answer from something in front of the API.
  }
  return undefined;
}

/** Retry-After in seconds, given as seconds or as an HTTP date. */
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
