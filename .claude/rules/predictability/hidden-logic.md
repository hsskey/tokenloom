---
paths:
  - "**/*.ts"
---

# Make hidden behavior explicit

Let a function name, signature, and result type reveal its policy and side effects.
Do not perform validation, I/O, mutation, or fallback behavior that the caller cannot predict.
Return a discriminated result when failure is expected.
Keep default behavior close to the option that controls it.

Source: adapted from Toss Frontend Fundamentals predictability guidance.
