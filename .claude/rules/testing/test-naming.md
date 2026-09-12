---
paths:
  - "**/*.test.ts"
---

# Describe observable behavior in English

A reader should understand the protected behavior from the test description without reading the implementation.
Use domain language and describe the condition and observable result.

## Rules

- Write `describe` and `it` text in English.
- Name the unit or behavior in `describe` and express the condition and result in `it`.
- Prefix every `*.rules.test.ts` description with the required rule ID from `docs/reference/spec.md`.
- Describe an observable result rather than an implementation detail.
- Treat an outgoing dependency call as the result only when that call is the exit point under test.
- Use the canonical terms from `CONTEXT.md` and `docs/reference/spec.md`: Snapshot, design context, token, collection, mode, variant, warning code, budget ledger, reference output, and mutation.
- Check that the title remains useful when the implementation is hidden.

## Example

```ts
describe("color formatting (SPEC 4.4)", () => {
  it("R15 writes alpha below one as lowercase #rrggbbaa", () => {
    expect(toHex({ r: 1, g: 1, b: 1, a: 0.5 })).toBe("#ffffff80");
  });
});
```

Related rules: [[test-structure]] covers test shape, and [[rule-id-titles]] covers ID prefixes.

Source: adapted from `hsskey/assessment-kakaopayseccoding-web` testing guidance and the repository's rule-traceability contract.
