# Calibrate the benchmark host before judging timing thresholds

Absolute latency thresholds assume a healthy machine and cannot tell a real regression from a loaded or thermally throttled one.
Before running benchmarks, the verifier measures two host-independent operations - bulk object allocation and parsing a fixed 10 MB JSON payload - and compares them against a recorded baseline for that environment.

The probe runs in a fresh child process. An already expanded parent heap changes the reading, so measuring it in the gate's own process would report the gate's history rather than the host's speed.
Its input comes from the same deterministic synthetic snapshot generator the scale benchmark uses, so the payload is identical on every host and across every run.

When the host runs more than 1.5x slower than its baseline, the run is reported as an environment failure instead of a regression.
A host with no recorded baseline records its probe reading and key, and judges only the environment-independent measurements: byte sizes, compression ratios, and heap use.
Timing verdicts are withheld rather than guessed.

`packages/verify/baseline.json` holds the per-environment baselines, each derived from the median of five runs on an idle machine.
Maintainers own that file; a slow run is not a reason to raise a baseline.
