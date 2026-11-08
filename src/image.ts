import { PetioleError } from "./errors.js";

/**
 * An image to send: a Blob or a File (a browser's file input, React
 * Native's `fetch(uri).blob()`, Node's `fs.openAsBlob` or `imageFromPath`
 * of `@petiole/sdk/node`), or its bytes (an ArrayBuffer, a Uint8Array, a
 * Node Buffer).
 *
 * The API tells the type from the first bytes, and turns the photo upright
 * by its EXIF orientation.
 */
export type ImageInput = Blob | ArrayBuffer | ArrayBufferView;

/** An image already sent to an upload (`petiole.uploads.upload`), which any
 * number of predictions and analyses can be made of for a day. */
export interface UploadRef {
  uploadId: string;
}

export function isUploadRef(value: unknown): value is UploadRef {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Blob) &&
    typeof (value as { uploadId?: unknown }).uploadId === "string"
  );
}

/** image as a Blob, its bytes not copied where they need not be. */
export function toBlob(image: ImageInput, type?: string): Blob {
  const options = type ? { type } : undefined;
  if (image instanceof Blob) return type && image.type !== type ? image.slice(0, image.size, type) : image;
  if (image instanceof ArrayBuffer) return new Blob([image], options);
  if (ArrayBuffer.isView(image)) {
    const bytes = new Uint8Array(image.buffer, image.byteOffset, image.byteLength) as Uint8Array<ArrayBuffer>;
    return new Blob([bytes], options);
  }
  throw new PetioleError("An image is a Blob, a File, an ArrayBuffer or a Uint8Array.");
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/** The image's media type from its first bytes: JPEG, PNG, HEIC, HEIF,
 * AVIF, WebP or TIFF; undefined for anything else. */
export async function sniffContentType(image: ImageInput): Promise<string | undefined> {
  const head = new Uint8Array(await toBlob(image).slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (brand === "mif1" || brand === "msf1") return "image/heif";
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return "image/tiff";
  return undefined;
}
