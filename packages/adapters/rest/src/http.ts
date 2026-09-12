// docs/reference/spec.md section 8 failure normalization: one bounded 429 retry, two exponential 5xx retries, one request at a time.
// `fetch` is injected so tests cannot accidentally reach the network.
import { err, ok, type RestResult } from "./result";
import type { BeforeCall, HttpDeps, HttpResponse, ResponseHeaders } from "./http-port";

/**
 * Collect rate-limit response headers in lexical order.
 * Compare lowercase names while preserving values; non-iterable header implementations produce an empty object.
 * Redact values whose names contain `token` because this result may reach stderr or a file.
 */
export function rateLimitHeaders(headers: ResponseHeaders): Record<string, string> {
  const found: [string, string][] = [];
  for (const [name, value] of headers.entries?.() ?? []) {
    const key = name.toLowerCase();
    const wanted = key === "retry-after"
      || key.startsWith("x-ratelimit") || key.startsWith("ratelimit") || key.startsWith("x-figma");
    if (wanted) found.push([key, key.includes("token") ? "<redacted>" : value]);
  }
  return Object.fromEntries(found.sort(([a], [b]) => a.localeCompare(b)));
}

const SERVER_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
/** Missing `Retry-After` means no wait; guessing could consume the monthly budget. */
const UNKNOWN_RETRY_AFTER_SEC = Number.POSITIVE_INFINITY;

/** Parse `Retry-After` as seconds or an HTTP date using only the injected clock. */
export function parseRetryAfter(header: string | null, nowMs: number): number {
  if (header === null || header.trim() === "") return UNKNOWN_RETRY_AFTER_SEC;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(header);
  return Number.isNaN(at) ? UNKNOWN_RETRY_AFTER_SEC : Math.max(0, Math.round((at - nowMs) / 1000));
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseBody<T>(text: string, url: string): RestResult<T> {
  try {
    return ok(JSON.parse(text) as T);
  } catch {
    return err({ kind: "http", status: 200, detail: `invalid JSON from ${url}` });
  }
}

/**
 * Perform one GET. client.ts preserves single-request concurrency by iterating batches sequentially.
 * Every physical retry passes through `beforeCall` again.
 */
export async function getJson<T>(
  deps: HttpDeps, url: string, beforeCall: BeforeCall,
  onBody?: (text: string, headers: ResponseHeaders) => void,
): Promise<RestResult<T>> {
  let retried429 = false;
  let serverAttempts = 0;
  for (;;) {
    const veto = beforeCall();
    if (veto !== null) return err(veto);
    let res: HttpResponse;
    try {
      res = await deps.fetch(url, { headers: { "X-Figma-Token": deps.token } });
    } catch (error) {
      return err({ kind: "network", detail: error instanceof Error ? error.message : String(error) });
    }
    if (res.status === 429) {
      const sec = parseRetryAfter(res.headers.get("retry-after"), deps.nowMs());
      if (!retried429 && sec <= deps.retryAfterMaxSec) {
        retried429 = true;
        await deps.sleep(sec * 1000);
        continue;
      }
      const waitMs = Number.isFinite(sec) ? sec * 1000 : 0;
      return err({
        kind: "rate-limit",
        retryAfterSec: Number.isFinite(sec) ? sec : -1,
        retryAt: isoAt(deps.nowMs() + waitMs),
        detail: `429 from ${url}`,
      });
    }
    if (res.status >= 500) {
      if (serverAttempts < SERVER_RETRIES) {
        await deps.sleep(BACKOFF_BASE_MS * 2 ** serverAttempts);
        serverAttempts += 1;
        continue;
      }
      return err({ kind: "http", status: res.status, detail: `${res.status} from ${url}` });
    }
    if (res.status >= 400) return err({ kind: "http", status: res.status, detail: `${res.status} from ${url}` });
    const text = await res.text();
    // Raw response bytes exist only here; parsing and serializing would alter whitespace and key order.
    onBody?.(text, res.headers);
    return parseBody<T>(text, url);
  }
}


export type { BeforeCall, FetchLike, HttpDeps, HttpResponse, ResponseHeaders } from "./http-port";
