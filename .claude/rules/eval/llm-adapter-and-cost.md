---
paths:
  - "packages/eval/src/**/*.ts"
  - "eval/**"
---

# Isolate LLM calls and enforce cost guards

Tests and verifier self-tests use the fake adapter.
Real calls run only through the evaluation adapter with an explicit or derived budget.
Reject an explicit budget below the planned total before the first call.
Record usage and cost from adapter responses.
Do not invoke an LLM from token, parser, cache, or design-context code.

Source: docs/goals.md, docs/reference/spec.md evaluation contracts, and docs/reference/verification.md.
