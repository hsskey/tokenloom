---
paths:
  - "**/*.ts"
---

# Choose state cohesion deliberately

Keep values together when they are created, validated, and submitted as one unit.
Split state when fields have independent lifecycles or update rates.
Expose the smallest state shape a caller needs.
Do not group unrelated values merely because one screen currently renders them together.

Source: adapted from Toss Frontend Fundamentals cohesion guidance.
