// `@petiole/sdk/node`: what only Node does, kept out of the main entry so
// a web page's bundle never meets a node: module.
import { openAsBlob } from "node:fs";

/** A photo on disk as a Blob, which the SDK sends as it reads it rather
 * than all at once. */
export function imageFromPath(path: string, options?: { type?: string }): Promise<Blob> {
  return openAsBlob(path, options);
}
