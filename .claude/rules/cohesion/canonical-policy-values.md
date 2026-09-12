---
paths:
  - "**/*.ts"
---

# Keep policy values in one canonical place

Read limits, prices, thresholds, and budgets from their canonical configuration.
Do not copy a policy value into code, tests, documentation, or a derived rule.
Use named local constants only for implementation details that are not policy.
A value that changes with product policy belongs in the configuration owner.

Source: adapted from Toss Frontend Fundamentals cohesion guidance and repository gate contracts.
