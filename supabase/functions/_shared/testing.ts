/** Test doubles shared by *_test.ts files. No network: every call is recorded and answered locally. */

import type { Delay } from "./timeout.ts";

export type RecordedCall = { url: string; method: string; headers: Headers; body: unknown };

export function fakeFetch(handler: (call: RecordedCall) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetch = (input: string, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const call: RecordedCall = {
      url: input,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: raw === undefined ? undefined : JSON.parse(raw),
    };
    calls.push(call);
    return Promise.resolve().then(() => handler(call));
  };
  return { fetch, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Never resolves: simulates a hung upstream. */
export const hang = (): Promise<Response> => new Promise<Response>(() => {});

/** Fires immediately, recording the requested duration. */
export function instantDelay() {
  const requested: number[] = [];
  const delay: Delay = (ms) => {
    requested.push(ms);
    return { promise: Promise.resolve(), cancel: () => {} };
  };
  return { delay, requested };
}

/** Never fires: lets the fake fetch answer first. */
export const neverDelay: Delay = () => ({ promise: new Promise<void>(() => {}), cancel: () => {} });
