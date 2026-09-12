# Domain documentation

tokenloom uses one product context even though its implementation is split across workspace packages.
The packages are technical layers around the same design-conversion language, not separate business domains.

## Read before exploring

- Read `CONTEXT.md` at the repository root for canonical product terms.
- Read relevant decisions under `docs/adr/` before changing a boundary or public contract.
- Read `docs/architecture.md` before changing package dependencies or technology seams.

Proceed silently when a referenced optional document does not exist.

## Use the glossary

Use the canonical term from `CONTEXT.md` in issue titles, code-review comments, proposals, tests, and current documentation.
Keep legacy names only at explicit compatibility boundaries, serialized evidence fields, and historical paths.
When a new domain-specific term is necessary, update the glossary with a short definition and list ambiguous synonyms under `_Avoid_`.
Do not add general programming concepts or implementation details to `CONTEXT.md`.

## Record architectural decisions

Create an ADR only when the decision is costly to reverse, surprising without context, and chosen from real alternatives.
Keep ADRs short and link to retained historical evidence when it helps explain the trade-off.
Surface an ADR conflict before changing the established direction.
