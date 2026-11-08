// Small helpers that run in every runtime the package supports: no Node
// module, no global but those of the web platform, and process read only
// through globalThis, where it may be missing.

type Process = { env?: Record<string, string | undefined>; versions?: { node?: string } };

function processOf(): Process | undefined {
  return (globalThis as { process?: Process }).process;
}

/** An environment variable, where there is an environment; empty is unset. */
export function env(name: string): string | undefined {
  const value = processOf()?.env?.[name];
  return value === "" ? undefined : value;
}

/** Node's version, where this runs in Node (or a runtime that says so). */
export function nodeVersion(): string | undefined {
  return processOf()?.versions?.node;
}

/** Waits ms, or rejects with the signal's reason once it aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** A version 4 UUID, for an Idempotency-Key. crypto.randomUUID is missing
 * outside secure contexts and in some runtimes, so the bytes are made by
 * hand there. */
export function uuid(): string {
  const crypto = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Every item of a list the API pages with `startingAfter`, page by page. */
export async function* paginate<T extends { id: string }>(
  page: (startingAfter: string | undefined) => Promise<{ data: T[]; hasMore: boolean }>,
  startingAfter?: string,
): AsyncGenerator<T, void, undefined> {
  let after = startingAfter;
  for (;;) {
    const { data, hasMore } = await page(after);
    yield* data;
    const last = data.at(-1);
    if (!hasMore || !last) return;
    after = last.id;
  }
}
