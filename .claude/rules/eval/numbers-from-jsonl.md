---
paths:
  - "packages/eval/src/**/*.ts"
  - "eval/**"
  - "reports/**"
---

# Derive report numbers from run records

Compute report measurements from committed JSONL run records.
Read thresholds from eval/thresholds.json.
Do not type a measured value or threshold into report-generation code.
Normalize historical fields such as `fixture` and `irLevel` to `sampleName` and `inputVariant` only at the versioned read boundary.
Use recorded API usage for token counts rather than estimating from character length.

Source: the scoring gate in docs/reference/verification.md and docs/reference/spec.md report contract.
