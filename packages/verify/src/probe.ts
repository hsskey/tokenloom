// Environment-calibration probe for the benchmark gate. Runs as a child process and emits one
// JSON line to stdout. A fresh process is required: an already expanded parent heap changes the reading.
import { synthSnapshot } from "./synth";

/** Node count whose serialized snapshot is roughly 10 MB. synthSnapshot uses no randomness, so the payload is identical on every host. */
const PAYLOAD_NODES = 18_800;
const ALLOC_OBJECTS = 3_000_000;

export interface ProbeReading {
  allocMs: number;
  jsonParseMs: number;
}

/**
 * Measures allocation first. Keeping the 10 MB string alive while creating three million objects
 * can trigger major GC and double results on one host. Collection is intentionally excluded because
 * the probe measures allocation and parsing speed.
 */
export function measureProbe(): ProbeReading {
  let bucket: { i: number; v: number }[] | null = new Array<{ i: number; v: number }>(ALLOC_OBJECTS);
  const allocStart = performance.now();
  for (let i = 0; i < ALLOC_OBJECTS; i += 1) bucket[i] = { i, v: i % 7 };
  const allocMs = performance.now() - allocStart;
  bucket = null;
  const text = JSON.stringify(synthSnapshot(PAYLOAD_NODES));
  const parseStart = performance.now();
  const parsed = JSON.parse(text) as { version: number };
  const jsonParseMs = performance.now() - parseStart;
  if (parsed.version !== 1) throw new Error("probe: payload did not parse");
  return { allocMs: Number(allocMs.toFixed(3)), jsonParseMs: Number(jsonParseMs.toFixed(3)) };
}

process.stdout.write(JSON.stringify(measureProbe()));
