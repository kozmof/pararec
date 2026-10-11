export const REQUEST_TIMEOUT_MS = 15_000;

/** Bound the entire operation, including reading its response body. */
export async function boundedRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      const reason = signal?.reason ?? new Error("Request cancelled");
      controller.abort(reason);
      reject(reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(
        "The local server did not respond within 15 seconds. Retry the operation.",
      );
      controller.abort(error);
      reject(error);
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    if (signal?.aborted) abort();
    return await Promise.race([
      cancelled,
      signal?.aborted ? cancelled : operation(controller.signal),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
