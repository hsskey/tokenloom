// Shared measurement helpers; docs/reference/verification.md section 7 owns the thresholds these feed.
export interface BenchRecord {
  name: string;
  [key: string]: number | string;
}

export function rawPercentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function percentile(samples: number[], p: number): number {
  return Number(rawPercentile(samples, p).toFixed(3));
}

export function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  return Number(value.toFixed(3));
}

export function timed(warmup: number, runs: number, fn: () => void): number[] {
  for (let i = 0; i < warmup; i += 1) fn();
  const out: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    fn();
    out.push(performance.now() - started);
  }
  return out;
}
