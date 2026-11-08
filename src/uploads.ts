import * as api from "./generated/api.js";
import type { CreateUpload, Upload } from "./generated/model.js";
import { PetioleError } from "./errors.js";
import { type ImageInput, sniffContentType, toBlob } from "./image.js";
import type { RequestOptions, Transport } from "./transport.js";

export interface UploadOptions extends RequestOptions {
  /** The image's media type; told from its first bytes when not given. */
  contentType?: string;
}

/**
 * Images PUT to a signed URL, which predictions and analyses are then made
 * of by `{ uploadId }`, any number of times for a day. An upload suits
 * large images and mobile apps; a small image can go in the request itself.
 *
 * The PUT goes to the bucket, whose CORS takes the platform app's origins
 * only: from a web page, send the image in the request instead.
 */
export class Uploads {
  constructor(private readonly transport: Transport) {}

  /** Makes the signed URL to PUT one image to, of this type and size. */
  create(body: CreateUpload, options?: RequestOptions): Promise<Upload> {
    return api.createUpload(body, this.transport.init(options));
  }

  /** Makes an upload and PUTs the image to it; answers the upload, whose
   * `id` predictions and analyses take as `{ uploadId }`. */
  async upload(image: ImageInput, options: UploadOptions = {}): Promise<Upload> {
    const { contentType, ...request } = options;
    const blob = toBlob(image);
    const type = contentType ?? (await sniffContentType(blob)) ?? (blob.type || undefined);
    if (!type) throw new PetioleError("The image's type could not be told from its first bytes: give contentType.");
    const upload = await this.create({ contentType: type, sizeBytes: blob.size }, request);
    // Typed as declared, so a Content-Type the runtime adds is the same.
    await this.transport.put(upload.url, upload.headers, toBlob(blob, type), request);
    return upload;
  }
}
