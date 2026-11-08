# @petiole/sdk

The Petiole API from TypeScript: models that find leaves in a photo, and
workflows that measure them. Tested on Node 22 and 24; it has no
dependencies and uses only `fetch` and Web Crypto, so it is written to run
in Deno, Bun, edge functions and, behind a server of your own, browsers.

```sh
npm install @petiole/sdk
```

## Five minutes to a first answer

Make an API key on **Keys & access** in the [platform app](https://platform.petiole.pro),
scoped to what your code calls and with an expiry, and put it in the
environment:

```sh
export PETIOLE_API_KEY=ptl_live_…
```

Then, with a photo of a leaf on the calibration pad, `node quickstart.mjs leaf.jpg`:

```js
import { Petiole } from "@petiole/sdk";
import { imageFromPath } from "@petiole/sdk/node";

const petiole = new Petiole(); // the key from PETIOLE_API_KEY
const photo = await imageFromPath(process.argv[2] ?? "leaf.jpg");

// What a model finds: the leaf detector's boxes, each with its confidence.
const found = await petiole.models.predict("leaf-detector", photo);
console.log(`Leaves found: ${found.detections.length}, in ${found.durationMs} ms`);

// Their outlines: SAM 2.1 on the detector's boxes.
const outlined = await petiole.models.predict("sam2-small", photo, {
  boxes: found.detections.slice(0, 50).map((leaf) => leaf.bbox),
});
console.log(`Outlined: ${outlined.detections.length}, the first in ${outlined.detections[0]?.polygons?.[0]?.length} points`);

// What a workflow measures: leaf area in cm², from the calibration pad.
const measured = await petiole.analyze(photo, { workflow: "leaf_area_v1" });
if (measured.status === "succeeded") {
  for (const leaf of measured.result?.objects ?? []) {
    console.log(`${leaf.objectId}: ${leaf.properties.area_cm2} cm²`);
  }
} else {
  console.log(`Not measured: ${measured.reason} (${measured.code})`);
}
```

```text
Leaves found: 1, in 985 ms
Outlined: 1, the first in 517 points
ana_01M6YAZR69QA1YPGXJG6SX3XEC:leaf:det_001: 53.08485023720641 cm²
```

## The key

Keep the key on a server. It is shown once, when it is made; a key in a
web page's code is readable by every script on the page, and the API
sends no CORS headers, so a page cannot call it anyway. A web app's page
calls a function of its own site, which calls the API with the key.

- `new Petiole({ apiKey })`, or `PETIOLE_API_KEY` in the environment.
- A `ptl_test_` key is staging's: `new Petiole({ baseUrl: "https://api-staging.petiole.pro" })`,
  or `PETIOLE_BASE_URL`.
- `apiKey: null` sends no key, for a `baseUrl` of your own that adds it.
  This package is safe to bundle into a page for that:
  `new Petiole({ apiKey: null, baseUrl: "/api" })` calls `/api/v1/…` on
  the page's own site.
- A key's daily quotas bound what a leaked one costs. If one leaks, revoke
  it on Keys & access: a revoked key is refused within a minute.

## Models

A model finds; it measures nothing. Measurements are a workflow's.

```js
const { data } = await petiole.models.list();           // what your key may call
const model = await petiole.models.get("leaf-detector");
const prediction = await petiole.models.predict("leaf-detector", photo, {
  confThreshold: 0.25,  // the least score to report
  maxDetections: 100,
});
```

Every box and outline is in fractions, 0 to 1, of the image as it is shown
upright (its EXIF orientation applied, as a browser shows it), so it fits
the image drawn at any size: `x * width`, `y * height`. A `score` is the
model's confidence, never a probability.

A model that has been idle starts first, which takes up to a minute.
`predict` waits for it, up to `maxWaitMs` (two minutes). To have it awake
by the time a photo is chosen, ask its state as you show it, which wakes
it:

```js
await petiole.models.status("leaf-detector");        // ready, starting or unavailable
await petiole.models.waitUntilReady("leaf-detector"); // wakes it and waits
```

## Workflows

An analysis runs an image through a workflow, such as `leaf_area_v1`, and
returns the objects it measured with their properties; their units are in
`await petiole.objectTypes.get()`.

`petiole.analyze` sends the image, waits until the analysis has ended and
answers its result. An analysis that is `cancelled` is an outcome, not an
error: its `code` says why, such as `no_markers` for a photo without the
calibration pad. One that `failed` throws `AnalysisFailedError`.

Or step by step, such as with a webhook:

```js
const created = await petiole.analyses.create(photo, {
  workflow: "leaf_area_v1",
  webhookUrl: "https://example.com/hooks/petiole", // or your organisation's endpoint
  metadata: { plot: "B4" },                        // kept with it, never read
});
const ended = await petiole.analyses.wait(created.id, {
  onStatus: (analysis) => console.log(analysis.status, analysis.step?.name),
});
const result = await petiole.analyses.result(created.id);

for await (const analysis of petiole.analyses.iterate({ status: "succeeded" })) {
  console.log(analysis.id, analysis.finishedAt);
}
```

## Uploads

A photo can go in the request, as above, or through an upload: PUT once to
a signed URL, then predicted on and analysed by its id, any number of times
for a day. Uploads suit large images and mobile apps. They do not work
from a web page, since the bucket takes PUTs from the platform app's
origins only.

```js
const upload = await petiole.uploads.upload(photo);
await petiole.models.predict("leaf-detector", { uploadId: upload.id });
await petiole.analyze({ uploadId: upload.id }, { workflow: "leaf_area_v1" });
```

## Webhooks

An analysis's events go to its `webhookUrl`, or to your organisation's
endpoint, signed with your webhook's secret. Verify the raw body, before
parsing it:

```js
import { SIGNATURE_HEADER, verifyWebhook, WebhookSignatureError } from "@petiole/sdk";

export async function POST(request) {
  try {
    const event = await verifyWebhook({
      payload: await request.text(),
      signature: request.headers.get(SIGNATURE_HEADER),
      secret: process.env.PETIOLE_WEBHOOK_SECRET,
    });
    if (event.type === "analysis.succeeded") {
      // event.data is the analysis; read its result with analyses.result.
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WebhookSignatureError) return new Response(null, { status: 400 });
    throw error;
  }
}
```

A signature more than five minutes old is refused. A delivery is retried
until it is answered with a 2xx, so the same event can arrive twice: its
`id` tells. While you switch secrets, pass both: `secret: [oldSecret, newSecret]`.

## Errors

| Error | When |
| --- | --- |
| `ApiError` | The API answered with an error: `status`, `code` (such as `not_found`, `quota_exceeded`), `detail`, `requestId` to quote, and `errors` for `invalid_request` |
| `AnalysisFailedError` | An analysis ended `failed`, a technical failure |
| `ConnectionError` | The API could not be reached |
| `TimeoutError` | A request, or a wait, took longer than it was given |
| `UploadError` | An upload's PUT was refused |
| `WebhookSignatureError` | A webhook's signature did not verify |

All of them are `PetioleError`s. Codes grow: one your code does not know
goes by its `status`.

## Retries, timeouts and cancelling

- Every POST carries an `Idempotency-Key`, the same on each of its
  retries, so a retry never makes a second analysis. Give your own with
  `{ idempotencyKey }` to repeat a call safely yourself for 24 hours.
- Retried, twice by default (`maxRetries`): a connection that failed, a
  timeout, `rate_limited`, `service_unavailable`, `internal_error`. Never
  retried: `quota_exceeded`, which lasts until midnight UTC, and
  `concurrency_limit_exceeded`.
- An attempt may take 90 s (`timeoutMs`); the API answers within 60.
- Every call takes `{ signal }` from an `AbortController`, which cancels
  it with its retries and waits.

The options go to `new Petiole({ … })` for every call, or last to a call
for that call.

## Types

The API's own types come with the package, generated from its OpenAPI
spec: `Prediction`, `Detection`, `Box`, `AnalysisResult`, `ResultObject`,
`Problem` and the rest.

```ts
import type { Detection, ResultObject } from "@petiole/sdk";
```

## Source and contributing

The source is [getpetiole/petiole-sdk-typescript](https://github.com/getpetiole/petiole-sdk-typescript).
It is a copy, made at each release, of the SDK's directory in Petiole's
platform repository, where it is generated from the API's spec and tested
with the API. Issues and pull requests are welcome there; a change merged
is carried over and comes back with the next release. Report a
vulnerability privately, as [SECURITY.md](https://github.com/getpetiole/.github/blob/main/SECURITY.md)
says.

```sh
npm ci
npm run generate       # src/generated from openapi.yaml
npm run typecheck
npm test               # unit tests, on a fake fetch
npm run test:contract  # every call against Prism's mock of openapi.yaml (Node 24)
npm run build && npm run check:browser
```

## Licence

MIT.
