---
paths:
  - "packages/**/*.ts"
  - "apps/**/*.ts"
  - "architecture.test.ts"
  - "tsconfig.base.json"
---

# Keep dependencies pointed inward

Read `docs/architecture.md` before moving a package interface or adding a technology dependency.
Schema, parser, and token modules must not import apps, adapters, evaluation, verification, benchmarks, or scripts.
Parser and token modules may depend on schema contracts.
Keep Figma response fields, network calls, child processes, file persistence, and transport formatting in their adapters or composition roots.
Define a structural port at an existing technology seam and inject it into pure orchestration.
Do not add Java-style service classes, a runtime dependency-injection framework, or one-method interfaces for operations that do not vary.
Update `architecture.test.ts` when the intended package graph changes.

Source: `docs/adr/0004-use-a-functional-package-level-hexagon.md` and `docs/architecture.md`.
