import type { RestFailure } from "./result";

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null; entries?(): Iterable<[string, string]> };
  text(): Promise<string>;
}

export type ResponseHeaders = HttpResponse["headers"];
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

export interface HttpDeps {
  fetch: FetchLike;
  token: string;
  retryAfterMaxSec: number;
  nowMs: () => number;
  sleep: (ms: number) => Promise<void>;
}

export type BeforeCall = () => RestFailure | null;
