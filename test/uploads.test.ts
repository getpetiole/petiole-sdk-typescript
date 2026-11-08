import { describe, expect, it } from "vitest";

import { PetioleError, sniffContentType, UploadError } from "../src/index.js";
import { toBlob } from "../src/image.js";
import { client, fakeFetch, JPEG, json, PNG } from "./fake.js";

const UPLOAD = {
  id: "upl_01JQ8ZC5T4V7B9K2MNPQRSTWXZ",
  object: "upload",
  url: "https://storage.test/bucket/upl_01?X-Goog-Signature=secret",
  headers: { "Content-Type": "image/png", "x-goog-content-length-range": "16,16" },
  expiresAt: "2026-11-08T13:00:00Z",
};

describe("upload", () => {
  it("tells the type, makes the upload and PUTs the image with exactly its headers", async () => {
    const { fetch, requests } = fakeFetch(json(UPLOAD, 201), () => new Response(null, { status: 200 }));
    const upload = await client(fetch).uploads.upload(PNG);

    expect(upload.id).toBe(UPLOAD.id);
    expect(await requests[0]?.json()).toEqual({ contentType: "image/png", sizeBytes: PNG.byteLength });
    const put = requests[1]!;
    expect(`${put.method} ${put.url}`).toBe(`PUT ${UPLOAD.url}`);
    expect(put.headers.get("content-type")).toBe("image/png");
    expect(put.headers.get("x-goog-content-length-range")).toBe("16,16");
    expect(put.headers.has("authorization")).toBe(false);
    expect(new Uint8Array(await put.arrayBuffer())).toEqual(PNG);
  });

  it("retries a PUT the bucket could not take, and says why it refused one", async () => {
    const { fetch, requests } = fakeFetch(
      json(UPLOAD, 201),
      () => new Response("busy", { status: 503 }),
      () => new Response("<Error>SignatureDoesNotMatch</Error>", { status: 403 }),
    );
    const error = await client(fetch).uploads.upload(PNG).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).status).toBe(403);
    expect((error as Error).message).toContain("SignatureDoesNotMatch");
    expect((error as Error).message).not.toContain("X-Goog-Signature");
    expect(requests).toHaveLength(3);
  });

  it("asks for the type when the bytes do not tell it", async () => {
    const { fetch } = fakeFetch();
    await expect(client(fetch).uploads.upload(new Uint8Array([1, 2, 3]))).rejects.toThrow(PetioleError);
  });
});

describe("images", () => {
  it("are told by their first bytes", async () => {
    const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode(`ftyp${brand}`)]);
    expect(await sniffContentType(JPEG)).toBe("image/jpeg");
    expect(await sniffContentType(PNG)).toBe("image/png");
    expect(await sniffContentType(ftyp("heic"))).toBe("image/heic");
    expect(await sniffContentType(ftyp("mif1"))).toBe("image/heif");
    expect(await sniffContentType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(await sniffContentType(new Blob(["not an image"]))).toBeUndefined();
  });

  it("are sent as the bytes of a view, not of its whole buffer", async () => {
    const buffer = new Uint8Array([9, 9, ...JPEG, 9]);
    const view = buffer.subarray(2, 2 + JPEG.length);
    expect(new Uint8Array(await toBlob(view).arrayBuffer())).toEqual(JPEG);
  });
});
