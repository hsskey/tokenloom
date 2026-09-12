---
paths:
  - "packages/**/src/**/*.ts"
  - "apps/**/src/**/*.ts"
  - "scripts/**/*.ts"
---

# Avoid patterns rejected by static gates

Review docs/reference/verification.md section 3 before editing production source.
Do not add hidden network access, nondeterminism, empty catches, unfinished markers, test bypasses, or direct unstable serialization.
Fix the design instead of spelling a forbidden operation differently.
After changing applicable files, run `pnpm verify --gate types,patterns`.

Source: docs/reference/verification.md type and forbidden-pattern gates.
