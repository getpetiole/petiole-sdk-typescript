import * as api from "./generated/api.js";
import type { Box, ListModelsParams, Model, ModelDetail, ModelList, ModelStatus, Prediction } from "./generated/model.js";
import { PetioleError, TimeoutError } from "./errors.js";
import { type ImageInput, isUploadRef, toBlob, type UploadRef } from "./image.js";
import { paginate, sleep } from "./internal.js";
import type { RequestOptions, Transport } from "./transport.js";

/** A model that is starting takes up to a minute (its port opens 30 to 40 s
 * after an instance starts); two give it room. */
const MODEL_WAIT_MS = 120_000;
const STATUS_POLL_MS = 2_000;

export interface PredictOptions extends RequestOptions {
  /** For a model that outlines what it is given (`sam2-small`): the boxes to
   * outline, such as a detector's, in fractions of the image; at most 50.
   * Required by such a model, refused by any other. */
  boxes?: Box[];
  /** A detector's or a segmenter's least score to report, between 0 and 1;
   * the model's own by default. */
  confThreshold?: number;
  /** At most this many detections, the highest scores first; 300 by default. */
  maxDetections?: number;
  /** How long to wait for a model that is starting, in milliseconds: two
   * minutes by default. 0 throws its `model_starting` at once. */
  maxWaitMs?: number;
}

export interface ModelWaitOptions extends RequestOptions {
  /** How long to wait, in milliseconds: two minutes by default. */
  maxWaitMs?: number;
  /** How often to ask, in milliseconds: every 2 s by default. */
  pollIntervalMs?: number;
}

/** The models the workflows your key may use run: what each finds, its
 * state, and predictions with it. A model finds; it measures nothing:
 * measurements are a workflow's (`petiole.analyze`). */
export class Models {
  constructor(private readonly transport: Transport) {}

  /** A page of models, in order of id. */
  list(params?: ListModelsParams, options?: RequestOptions): Promise<ModelList> {
    return api.listModels(params, this.transport.init(options));
  }

  /** Every model, page after page. */
  iterate(params?: ListModelsParams, options?: RequestOptions): AsyncGenerator<Model, void, undefined> {
    return paginate((startingAfter) => this.list({ ...params, startingAfter }, options), params?.startingAfter);
  }

  /** A model, with the workflows that run it. */
  get(id: string, options?: RequestOptions): Promise<ModelDetail> {
    return api.getModel(id, this.transport.init(options));
  }

  /** Whether the model can answer a prediction now: `ready`, `starting`
   * (waking, up to a minute) or `unavailable`. Asking wakes a model that is
   * not running, so ask as you show the model, and it is awake by the time a
   * photo is chosen. */
  status(id: string, options?: RequestOptions): Promise<ModelStatus> {
    return api.getModelStatus(id, this.transport.init(options));
  }

  /** Wakes the model and waits until it is `ready`. Throws when it is
   * `unavailable`, or with TimeoutError past `maxWaitMs`. */
  async waitUntilReady(id: string, options: ModelWaitOptions = {}): Promise<ModelStatus> {
    const { maxWaitMs = MODEL_WAIT_MS, pollIntervalMs = STATUS_POLL_MS, ...request } = options;
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const status = await this.status(id, request);
      if (status.status === "ready") return status;
      if (status.status === "unavailable") {
        throw new PetioleError(`The model ${id} is unavailable: it cannot answer predictions now.`);
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new TimeoutError(`The model ${id} was still starting after ${maxWaitMs} ms.`);
      await sleep(Math.min(pollIntervalMs, left), request.signal);
    }
  }

  /**
   * Runs the model over one image and answers what it found, in the
   * request: labels, scores, boxes and, for a segmenter, outlines, in
   * fractions of the image as it is shown upright, so they fit it drawn at
   * any size. A score is the model's confidence, never a probability.
   *
   * The image goes in the request (JPEG or PNG, at most 20 MiB), or is an
   * upload's (`{ uploadId }`). A model that is starting is waited for, up
   * to `maxWaitMs`.
   */
  predict(id: string, image: ImageInput | UploadRef, options: PredictOptions = {}): Promise<Prediction> {
    const { boxes, confThreshold, maxDetections, maxWaitMs = MODEL_WAIT_MS, ...request } = options;
    const init = { ...this.transport.init(request), modelStartingUntil: Date.now() + maxWaitMs };
    if (isUploadRef(image)) {
      return api.createPredictionWithJson(id, { uploadId: image.uploadId, boxes, confThreshold, maxDetections }, init);
    }
    return api.createPredictionWithFormData(
      id,
      { image: toBlob(image), boxes: boxes && JSON.stringify(boxes), confThreshold, maxDetections },
      init,
    );
  }
}
