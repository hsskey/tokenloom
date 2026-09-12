---
paths:
  - "**/*.ts"
---

# Give each unit one responsibility

Separate parsing, policy decisions, side effects, and presentation when they can change independently.
Make dependencies explicit in parameters or constructors.
Return typed results at boundaries rather than mutating hidden state.
Keep orchestration readable as a sequence of domain operations.

Source: adapted from Toss Frontend Fundamentals coupling guidance.
