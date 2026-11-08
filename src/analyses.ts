import * as api from "./generated/api.js";
import type {
  Analysis,
  AnalysisCreated,
  AnalysisDetail,
  AnalysisList,
  AnalysisResult,
  DeletedAnalysis,
  ListAnalysesParams,
} from "./generated/model.js";
import { TimeoutError } from "./errors.js";
import { type ImageInput, isUploadRef, toBlob, type UploadRef } from "./image.js";
import { paginate, sleep } from "./internal.js";
import type { RequestOptions, Transport } from "./transport.js";

const ANALYSIS_WAIT_MS = 600_000;
const FIRST_POLL_MS = 1_000;
const LONGEST_POLL_MS = 5_000;

export interface CreateAnalysisOptions extends RequestOptions {
  /** The workflow to run the image through, such as `leaf_area_v1`: one of
   * `petiole.workflows.list()`. */
  workflow: string;
  /** Where to POST the analysis's events, in place of the organisation's
   * webhook endpoint: `https`, on the public internet. */
  webhookUrl?: string;
  /** Anything to keep with the analysis, up to 4096 bytes as JSON; returned
   * as it was sent and never read. */
  metadata?: Record<string, unknown>;
}

export interface WaitOptions extends RequestOptions {
  /** How long to wait for the analysis to end, in milliseconds: ten minutes
   * by default. Past it, TimeoutError; the analysis goes on. */
  maxWaitMs?: number;
  /** Called with the analysis each time it is asked, such as to show its
   * step ("step 4 of 11"). */
  onStatus?: (analysis: AnalysisDetail) => void;
  /** How long to wait before asking again at first, in milliseconds: 1 s,
   * growing to 5 s. */
  pollIntervalMs?: number;
}

/** Images run through a workflow: their status, their results. */
export class Analyses {
  constructor(private readonly transport: Transport) {}

  /**
   * Starts an analysis of an image and answers at once that it was
   * accepted; follow it with `wait`, or by webhook, then read `result`.
   * `petiole.analyze` does all three.
   *
   * The image goes in the request, or is an upload's (`{ uploadId }`),
   * which suits large images and can be analysed any number of times.
   */
  create(image: ImageInput | UploadRef, options: CreateAnalysisOptions): Promise<AnalysisCreated> {
    const { workflow, webhookUrl, metadata, ...request } = options;
    const init = this.transport.init(request);
    if (isUploadRef(image)) {
      return api.createAnalysisWithJson({ uploadId: image.uploadId, workflow, webhookUrl, metadata }, init);
    }
    return api.createAnalysisWithFormData(
      { image: toBlob(image), workflow, webhookUrl, metadata: metadata && JSON.stringify(metadata) },
      init,
    );
  }

  /** An analysis's status: where it is, the step running, and how it ended,
   * with its timeline. */
  get(id: string, options?: RequestOptions): Promise<AnalysisDetail> {
    return api.getAnalysis(id, this.transport.init(options));
  }

  /** A page of the organisation's analyses, newest first. */
  list(params?: ListAnalysesParams, options?: RequestOptions): Promise<AnalysisList> {
    return api.listAnalyses(params, this.transport.init(options));
  }

  /** Every analysis that matches, page after page, newest first. */
  iterate(params?: ListAnalysesParams, options?: RequestOptions): AsyncGenerator<Analysis, void, undefined> {
    return paginate((startingAfter) => this.list({ ...params, startingAfter }, options), params?.startingAfter);
  }

  /**
   * The outcome of an analysis that has ended: the objects a succeeded one
   * measured, or the `code` and `reason` of a cancelled or failed one. While
   * it runs, its status only. Read it when it is needed, not on every poll:
   * the URLs of its files, if any, are made for each request.
   */
  result(id: string, options?: RequestOptions): Promise<AnalysisResult> {
    return api.getAnalysisResult(id, this.transport.init(options));
  }

  /** Deletes an analysis that has ended: its image, its result and its
   * status. One that has not ended is refused with `analysis_not_ended`. */
  delete(id: string, options?: RequestOptions): Promise<DeletedAnalysis> {
    return api.deleteAnalysis(id, this.transport.init(options));
  }

  /**
   * Waits until the analysis has ended and answers its status. It ends
   * `succeeded`; `cancelled`, an outcome such as a photo without the
   * calibration pad, named by `code`; or `failed`. A failed attempt that is
   * retried has not ended, so this waits for `final`.
   */
  async wait(id: string, options: WaitOptions = {}): Promise<AnalysisDetail> {
    const { maxWaitMs = ANALYSIS_WAIT_MS, onStatus, pollIntervalMs = FIRST_POLL_MS, ...request } = options;
    const deadline = Date.now() + maxWaitMs;
    let interval = pollIntervalMs;
    for (;;) {
      const analysis = await this.get(id, request);
      onStatus?.(analysis);
      if (analysis.final) return analysis;
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new TimeoutError(`The analysis ${id} had not ended after ${maxWaitMs} ms: it is ${analysis.status}.`);
      }
      await sleep(Math.min(interval, left), request.signal);
      interval = Math.min(interval * 1.5, Math.max(LONGEST_POLL_MS, pollIntervalMs));
    }
  }
}
