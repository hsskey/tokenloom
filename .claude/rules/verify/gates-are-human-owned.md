---
paths:
  - "packages/verify/**"
  - "verify/**"
---

# Change gate contracts only through explicit maintainer decisions

Do not weaken a threshold, forbidden pattern, allowlist, self-test expectation, or reference output to obtain a pass.
When evidence contradicts a gate, stop the work it covers and take the exact reproduction and proposed change to a maintainer.
Keep committed verification JSON immutable.
A gate implementation change must retain a self-test that fails for the targeted defect.

Source: docs/reference/verification.md and AGENTS.md.
