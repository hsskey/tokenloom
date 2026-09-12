---
paths:
  - "**/*.test.ts"
---

# Use stubs for input and mocks for output

Stub a dependency that provides data to the unit.
Mock an outgoing side effect only when the call itself is the observable result.
Use real pure functions and value objects.
Inject filesystem, time, randomness, network, and process boundaries rather than mocking internals.
Do not verify that a stub was called.

Source: adapted from The Art of Unit Testing.
