// @petiole/sdk: the Petiole API from TypeScript, in Node, browsers, Deno,
// Bun and edge runtimes. Keys stay on a server; a web page calls a function
// of its own site, which calls the API (README, "In a web app").
export { Petiole, DEFAULT_BASE_URL, type PetioleOptions, type AnalyzeOptions } from "./client.js";
export { Models, type PredictOptions, type ModelWaitOptions } from "./models.js";
export { Analyses, type CreateAnalysisOptions, type WaitOptions } from "./analyses.js";
export { Uploads, type UploadOptions } from "./uploads.js";
export { Workflows, ObjectTypes, UsageReports } from "./catalog.js";
export {
  PetioleError,
  ApiError,
  ConnectionError,
  TimeoutError,
  UploadError,
  AnalysisFailedError,
  WebhookSignatureError,
} from "./errors.js";
export { verifyWebhook, SIGNATURE_HEADER, DELIVERY_HEADER, type VerifyWebhookOptions } from "./webhooks.js";
export { sniffContentType, type ImageInput, type UploadRef } from "./image.js";
export type { RequestOptions } from "./transport.js";
export { VERSION } from "./version.js";
// The API's own types, generated from its spec: Prediction, Detection,
// AnalysisResult, ResultObject, Problem and the rest.
export type * from "./generated/model.js";
