/**
 * Fetch with a deadline. The delay is injectable so tests can fire the
 * timeout instantly against a fake fetch that never resolves.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Resolves after `ms`; `cancel` stops the timer so nothing leaks. */
export type Delay = (ms: number) => { promise: Promise<void>; cancel: () => void };

export const realDelay: Delay = (ms) => {
  let id: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    id = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(id) };
};

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`request timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  ms: number,
  delay: Delay,
): Promise<Response> {
  const controller = new AbortController();
  const timer = delay(ms);
  const timedOut = timer.promise.then(() => {
    controller.abort();
    throw new TimeoutError(ms);
  });
  try {
    return await Promise.race([fetchFn(url, { ...init, signal: controller.signal }), timedOut]);
  } finally {
    timer.cancel();
  }
}
