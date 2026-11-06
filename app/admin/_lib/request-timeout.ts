export class RequestTimeoutError extends Error {
  constructor() {
    super("The request timed out.");
    this.name = "RequestTimeoutError";
  }
}

export class RequestCancelledError extends Error {
  constructor() {
    super("The request was cancelled.");
    this.name = "RequestCancelledError";
  }
}

export function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function fetchJsonWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; payload: unknown }> {
  const endpoint = new URL(input, "https://admin.local").pathname;
  const controller = new AbortController();
  const externalSignal = init.signal;
  const startedAt = Date.now();
  if (externalSignal?.aborted) {
    throw externalSignal.reason ?? new Error("The request was cancelled.");
  }
  let removeAbortListener = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    if (!externalSignal) return;
    const abort = () => {
      controller.abort();
      reject(new RequestCancelledError());
    };
    if (externalSignal.aborted) {
      abort();
    } else {
      externalSignal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () =>
        externalSignal.removeEventListener("abort", abort);
    }
  });
  const request = (async () => {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { response, payload };
  })();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError());
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([request, timeout, cancellation]);
    if (!result.response.ok) {
      console.warn("[admin-data] request returned an HTTP error", {
        endpoint,
        status: result.response.status,
        durationMs: Date.now() - startedAt,
      });
    }
    return result;
  } catch (cause) {
    console.warn("[admin-data] request failed", {
      endpoint,
      outcome:
        cause instanceof RequestTimeoutError
          ? "timeout"
          : controller.signal.aborted
            ? "cancelled"
            : "network_error",
      durationMs: Date.now() - startedAt,
    });
    throw cause;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeAbortListener();
  }
}
