---
paths:
  - "**/*.test.ts"
---

# Use Arrange, Act, Assert

Keep setup explicit and local, perform one action, and assert one exit-point type.
Prefer factory functions over shared mutable beforeEach state.
Keep branching and loops out of test bodies.
Use it.each for cases that differ only by input.
A black-box CLI test may need longer setup, but its action and expected output should remain obvious.

Related rules: [[test-doubles]] covers doubles, and [[test-naming]] covers descriptions.

Source: adapted from The Art of Unit Testing.
