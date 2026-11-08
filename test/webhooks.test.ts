import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyWebhook, WebhookSignatureError } from "../src/index.js";
import { analysis } from "./fake.js";

const SECRET = "ptl_whsec_7Hk2Lq9Xz4Rv1Bn6Ts8Wc3Ym5Pd0Ga2E";
const OLD_SECRET = "ptl_whsec_0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld";
const NOW = 1_762_600_000;
const BODY = JSON.stringify({
  id: "whd_01JQ8ZC5T4V7B9K2MNPQRSTWXZ",
  type: "analysis.succeeded",
  createdAt: "2026-11-08T12:00:00Z",
  data: analysis("succeeded", true),
});

// The dispatcher's signature, as the spec says it: hex HMAC-SHA256 under
// the secret of t, a dot and the raw body.
const sign = (secret: string, t: number, body = BODY) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

describe("verifyWebhook", () => {
  it("answers the event of a body signed with the secret", async () => {
    const event = await verifyWebhook({ payload: BODY, signature: `t=${NOW},v1=${sign(SECRET, NOW)}`, secret: SECRET, now: NOW });
    expect(event.type).toBe("analysis.succeeded");
    expect(event.data.status).toBe("succeeded");
  });

  it("takes the body as bytes", async () => {
    const payload = new TextEncoder().encode(BODY);
    const event = await verifyWebhook({ payload, signature: `t=${NOW},v1=${sign(SECRET, NOW)}`, secret: SECRET, now: NOW });
    expect(event.id).toBe("whd_01JQ8ZC5T4V7B9K2MNPQRSTWXZ");
  });

  it("takes either signature after a rotation, and either secret while switching", async () => {
    const signature = `t=${NOW},v1=${sign(OLD_SECRET, NOW)},v1=${sign(SECRET, NOW)}`;
    await expect(verifyWebhook({ payload: BODY, signature, secret: SECRET, now: NOW })).resolves.toBeTruthy();
    await expect(verifyWebhook({ payload: BODY, signature, secret: OLD_SECRET, now: NOW })).resolves.toBeTruthy();
    const onlyNew = `t=${NOW},v1=${sign(SECRET, NOW)}`;
    await expect(verifyWebhook({ payload: BODY, signature: onlyNew, secret: [OLD_SECRET, SECRET], now: NOW })).resolves.toBeTruthy();
  });

  it.each([
    ["another secret", `t=${NOW},v1=${sign(OLD_SECRET, NOW)}`, BODY],
    ["a changed body", `t=${NOW},v1=${sign(SECRET, NOW)}`, BODY.replace("succeeded", "cancelled")],
    ["another time", `t=${NOW + 1},v1=${sign(SECRET, NOW)}`, BODY],
    ["a stale signature", `t=${NOW - 301},v1=${sign(SECRET, NOW - 301)}`, BODY],
    ["no v1", `t=${NOW}`, BODY],
    ["no t", `v1=${sign(SECRET, NOW)}`, BODY],
    ["a short v1", `t=${NOW},v1=abc`, BODY],
    ["no header", "", BODY],
  ])("refuses %s", async (_, signature, payload) => {
    await expect(verifyWebhook({ payload, signature, secret: SECRET, now: NOW })).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("refuses to verify without a secret", async () => {
    const signature = `t=${NOW},v1=${sign(SECRET, NOW)}`;
    await expect(verifyWebhook({ payload: BODY, signature, secret: "", now: NOW })).rejects.toThrow(/secret/);
  });
});
