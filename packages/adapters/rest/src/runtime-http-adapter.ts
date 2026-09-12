import type { HttpDeps } from "./http-port";

export function createHttpDeps(token: string, retryAfterMaxSec: number): HttpDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    token,
    retryAfterMaxSec,
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((done) => { setTimeout(done, ms); }),
  };
}
