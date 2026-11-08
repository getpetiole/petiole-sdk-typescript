import type { AnalysisResult } from "./generated/model.js";
import { Analyses, type CreateAnalysisOptions, type WaitOptions } from "./analyses.js";
import { ObjectTypes, UsageReports, Workflows } from "./catalog.js";
import { AnalysisFailedError, PetioleError } from "./errors.js";
import type { ImageInput, UploadRef } from "./image.js";
import { env } from "./internal.js";
import { Models } from "./models.js";
import { Transport } from "./transport.js";
import { Uploads } from "./uploads.js";

/** The API on production. Staging is https://api-staging.petiole.pro, with
 * `ptl_test_` keys. */
export const DEFAULT_BASE_URL = "https://api.petiole.pro";

/** The API answers within 60 s; an attempt is given longer. */
const TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;

export interface PetioleOptions {
  /**
   * Your API key, `ptl_live_…` (or `ptl_test_…` on staging), from Keys &
   * access in the platform app; `PETIOLE_API_KEY` from the environment by
   * default. Keep it on a server: never in a web page's code.
   *
   * `null` sends no key, for a `baseUrl` of your own that adds it, such as
   * a function of your site that calls the API.
   */
  apiKey?: string | null;
  /** The API's URL: `PETIOLE_BASE_URL` from the environment, or production. */
  baseUrl?: string;
  /** The fetch to call: the runtime's by default. */
  fetch?: typeof fetch;
  /** How long one attempt of a call may take, in milliseconds: 90 s. */
  timeoutMs?: number;
  /** How many times a failure that may pass is retried: twice. */
  maxRetries?: number;
  /** Headers sent with every call. */
  headers?: Record<string, string>;
}

export interface AnalyzeOptions extends CreateAnalysisOptions, Omit<WaitOptions, keyof CreateAnalysisOptions> {}

/**
 * The Petiole API.
 *
 * ```ts
 * const petiole = new Petiole(); // PETIOLE_API_KEY from the environment
 * const found = await petiole.models.predict("leaf-detector", photo);
 * const measured = await petiole.analyze(photo, { workflow: "leaf_area_v1" });
 * ```
 */
export class Petiole {
  /** Models: what each finds, its state, predictions with it. */
  readonly models: Models;
  /** Analyses: images run through a workflow, their status and results. */
  readonly analyses: Analyses;
  /** Uploads: large images PUT once, predicted on and analysed by id. */
  readonly uploads: Uploads;
  /** The workflows your key may use. */
  readonly workflows: Workflows;
  /** What a result's objects hold, with their units. */
  readonly objectTypes: ObjectTypes;
  /** The analyses your key has run, by day. */
  readonly usage: UsageReports;

  private readonly transport: Transport;

  constructor(options: PetioleOptions = {}) {
    const apiKey = options.apiKey === undefined ? env("PETIOLE_API_KEY") : (options.apiKey ?? undefined);
    const baseUrl = (options.baseUrl ?? env("PETIOLE_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!apiKey && options.apiKey !== null) {
      throw new PetioleError(
        "No API key: give { apiKey } or set PETIOLE_API_KEY. Make one on Keys & access in the platform app, " +
          "with the scopes this code needs and an expiry.",
      );
    }
    this.transport = new Transport({
      apiKey,
      baseUrl,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
      maxRetries: options.maxRetries ?? MAX_RETRIES,
      headers: options.headers ?? {},
    });
    this.models = new Models(this.transport);
    this.analyses = new Analyses(this.transport);
    this.uploads = new Uploads(this.transport);
    this.workflows = new Workflows(this.transport);
    this.objectTypes = new ObjectTypes(this.transport);
    this.usage = new UsageReports(this.transport);
  }

  /** The API's URL this client calls. */
  get baseUrl(): string {
    return this.transport.config.baseUrl;
  }

  /**
   * Runs an image through a workflow, waits until it has ended, and answers
   * its result: `analyses.create`, `analyses.wait` and `analyses.result` in
   * one call.
   *
   * A succeeded analysis's `result.objects` are what it measured, their
   * properties named and with units as `objectTypes.get()` says, such as a
   * leaf's `area_cm2`. A `cancelled` one is an outcome, not an error: its
   * `code` says why, such as `no_markers` for a photo without the
   * calibration pad. A `failed` one throws AnalysisFailedError.
   */
  async analyze(image: ImageInput | UploadRef, options: AnalyzeOptions): Promise<AnalysisResult> {
    const { maxWaitMs, onStatus, pollIntervalMs, ...create } = options;
    const { signal, timeoutMs, maxRetries, headers } = create;
    const request = { signal, timeoutMs, maxRetries, headers };
    const created = await this.analyses.create(image, create);
    await this.analyses.wait(created.id, { ...request, maxWaitMs, onStatus, pollIntervalMs });
    const result = await this.analyses.result(created.id, request);
    if (result.status === "failed") throw new AnalysisFailedError(result);
    return result;
  }
}
