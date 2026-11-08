// A webhook's signature (the spec's webhooks.analysisEvent; sent by the
// dispatcher, M7-T4): `X-Sauron-Signature: t=<unix seconds>,v1=<hex>`, the
// HMAC-SHA256 under the secret, `ptl_whsec_…` as its UTF-8 text, of t, a
// dot and the raw body; after a rotation one `v1=` per secret for a day.
// On Web Crypto, so it runs in Node, Deno, Bun and edge functions alike.
import type { AnalysisEvent } from "./generated/model.js";
import { WebhookSignatureError } from "./errors.js";

/** The header with the signature. */
export const SIGNATURE_HEADER = "x-sauron-signature";
/** The header with the delivery's id, the event's `id`, the same on every
 * retry of it. */
export const DELIVERY_HEADER = "x-sauron-delivery";

/** A signature older than this, or this far ahead, is refused. */
const TOLERANCE_SECONDS = 300;

export interface VerifyWebhookOptions {
  /** The request's body exactly as it arrived, never parsed and
   * re-serialised: `await request.text()`, Express's `express.raw()`, a
   * Netlify or Lambda event's `body`. */
  payload: string | ArrayBuffer | ArrayBufferView;
  /** The `X-Sauron-Signature` header. */
  signature: string | null | undefined;
  /** Your webhook's signing secret, `ptl_whsec_…`, or several while you
   * switch from one to another. */
  secret: string | readonly string[];
  /** How old a signature may be, in seconds: five minutes. */
  toleranceSeconds?: number;
  /** Now, in seconds since the epoch, for tests. */
  now?: number;
}

/**
 * Checks a webhook's signature and answers its event; throws
 * WebhookSignatureError when it does not verify, which the endpoint answers
 * with a 400. A delivery can arrive more than once: its `id` tells.
 *
 * ```ts
 * const event = await verifyWebhook({
 *   payload: await request.text(),
 *   signature: request.headers.get(SIGNATURE_HEADER),
 *   secret: process.env.PETIOLE_WEBHOOK_SECRET!,
 * });
 * if (event.type === "analysis.succeeded") …
 * ```
 */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<AnalysisEvent> {
  const { payload, signature, toleranceSeconds = TOLERANCE_SECONDS } = options;
  const secrets = typeof options.secret === "string" ? [options.secret] : [...options.secret];
  if (!secrets.length || secrets.some((secret) => !secret)) throw new WebhookSignatureError("No webhook secret was given.");
  if (!signature) throw new WebhookSignatureError(`The request has no ${SIGNATURE_HEADER} header.`);

  const { timestamp, signatures } = parseSignature(signature);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new WebhookSignatureError(`The signature's time, ${timestamp}, is more than ${toleranceSeconds} s from now.`);
  }

  const body = bytesOf(payload);
  const signed = concat(new TextEncoder().encode(`${timestamp}.`), body);
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new WebhookSignatureError("This runtime has no Web Crypto to check the signature with.");
  for (const secret of secrets) {
    const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    for (const candidate of signatures) {
      // verify compares in constant time.
      if (await subtle.verify("HMAC", key, candidate, signed)) return parseEvent(body);
    }
  }
  throw new WebhookSignatureError("The signature does not match the body under the secret.");
}

function parseSignature(header: string): { timestamp: number; signatures: Uint8Array<ArrayBuffer>[] } {
  let timestamp: number | undefined;
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (name === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(hexBytes(value));
  }
  if (timestamp === undefined || !signatures.length) {
    throw new WebhookSignatureError(`The ${SIGNATURE_HEADER} header is not t=<seconds>,v1=<signature>.`);
  }
  return { timestamp, signatures };
}

function parseEvent(body: Uint8Array): AnalysisEvent {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as AnalysisEvent;
  } catch {
    throw new WebhookSignatureError("The body verifies but is not JSON.");
  }
}

function bytesOf(payload: string | ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength) as Uint8Array<ArrayBuffer>;
  }
  throw new WebhookSignatureError("The payload is the body as a string or its bytes.");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const both = new Uint8Array(a.length + b.length);
  both.set(a);
  both.set(b, a.length);
  return both;
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
