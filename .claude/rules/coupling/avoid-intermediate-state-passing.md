---
paths:
  - "**/*.ts"
---

# Avoid passing unrelated state through intermediate layers

Give data to the component or function that owns the operation.
Use composition or a focused context when intermediate layers would only forward values.
Keep dependencies visible at the boundary that uses them.
Do not introduce global state to avoid a short, coherent parameter list.

Source: adapted from Toss Frontend Fundamentals coupling guidance.
