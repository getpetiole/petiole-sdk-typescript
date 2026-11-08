# Changelog

## 0.1.1 (2026-11-08)

- The package names its source, [getpetiole/petiole-sdk-typescript](https://github.com/getpetiole/petiole-sdk-typescript),
  which publishes it from now on, with npm's provenance.
- The README says where the source is and how to work on it.

No change to the code.

## 0.1.0 (2026-11-08)

The first version, on the API's v1 (`openapi.yaml` of 2026-11-08):

- `Petiole`, with the key from `PETIOLE_API_KEY` and the URL from
  `PETIOLE_BASE_URL`.
- Models: `list`, `iterate`, `get`, `status`, `waitUntilReady` and
  `predict`, which waits for a model that is starting.
- Analyses: `petiole.analyze` (send, wait, result), `create`, `get`,
  `list`, `iterate`, `wait`, `result` and `delete`.
- Uploads: `create` and `upload`, the PUT to the signed URL.
- Workflows, object types and usage.
- `verifyWebhook` on Web Crypto, for `X-Sauron-Signature`.
- An Idempotency-Key on every POST, kept across its retries; retries of
  what may pass, never of a quota; a timeout per attempt; `AbortSignal`.
- `@petiole/sdk/node`: `imageFromPath`.
