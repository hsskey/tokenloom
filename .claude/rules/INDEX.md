# Path-scoped rule index

This directory contains the engineering rules that coding agents apply when reading or changing matching paths.
Each file covers one topic and declares its scope in YAML frontmatter.
This file is navigation, not an additional rule source.

Repository rules for determinism, boundaries, CLI behavior, scope, evaluation, verification, and gate-specific testing derive from `docs/goals.md`, `docs/reference/spec.md`, and `docs/reference/verification.md`.
The general readability, predictability, cohesion, coupling, and testing rules derive from the sources named at the end of each file.
A source contract or executable gate wins over a conflicting derivative.

## Concerns and scope

| Concern | Protects | Typical scope |
|---|---|---|
| architecture | Inward package dependencies and explicit technology seams | package source, app source, and architecture tests |
| determinism | Identical input produces identical bytes | schema, parser, token, cache, and CLI source |
| boundaries | Snapshot isolation, network confinement, and Figma budgets | package and app source |
| cli | Exit codes, stdout/stderr, warnings, and strict mode | CLI, parser, and token source |
| scope | LOC limits, dependency allowlist, and forbidden patterns | production source, scripts, and manifests |
| readability | Code that reads in one direction | all TypeScript |
| predictability | Behavior that matches names and signatures | all TypeScript |
| cohesion | Things that change together live together | all TypeScript |
| coupling | One responsibility and deliberate sharing | all TypeScript |
| testing | Rule IDs, black-box reference output, properties, mutations, benchmarks, and strong assertions | tests, sample data, and benchmarks |
| eval | Scoring, report evidence, LLM adapters, and cost guards | evaluation source, configuration, and reports |
| verify | Maintainer-controlled gates | verifier source and proof records |

## Determinism

- [stable-bytes](./determinism/stable-bytes.md) - avoid time, randomness, and key-order dependence; serialize output with stable ordering.
- [unknown-passthrough](./determinism/unknown-passthrough.md) - preserve an unknown node as `role: unknown` with a warning.

## Architecture

- [dependency-direction](./architecture/dependency-direction.md) - keep core packages inward and isolate I/O behind explicit ports and adapters.

## Boundaries

- [snapshot-only](./boundaries/snapshot-only.md) - parsers and token builders read `Snapshot`; Figma response fields stay in adapters.
- [network-confinement](./boundaries/network-confinement.md) - network access stays in the REST adapter and evaluation package; token extraction never calls an LLM.
- [figma-budget](./boundaries/figma-budget.md) - Figma calls stay within the plan matrix and pass through the budget ledger.

## CLI

- [exit-codes-and-streams](./cli/exit-codes-and-streams.md) - use the documented exit categories, reserve stdout for JSON in JSON mode, and send diagnostics to stderr.
- [warnings-not-exceptions](./cli/warnings-not-exceptions.md) - preserve warning codes and let strict mode promote them to failure.

## Scope

- [loc-budget](./scope/loc-budget.md) - stay within cumulative, per-file, per-line, and script limits from canonical configuration.
- [dependency-allowlist](./scope/dependency-allowlist.md) - stop and raise it with a maintainer before adding an unlisted dependency.
- [forbidden-patterns](./scope/forbidden-patterns.md) - avoid patterns rejected by the type and forbidden-pattern gates.

## Readability

- [comments](./readability/comments.md) - explain durable constraints and remove code narration or private work history.
- [comparison-order](./readability/comparison-order.md) - write comparisons in natural reading order.
- [condition-name](./readability/condition-name.md) - name a complex condition.
- [domain-operation-names](./readability/domain-operation-names.md) - hide low-level implementation behind a meaningful operation.
- [name-literals](./readability/name-literals.md) - give a non-obvious literal a name.
- [separate-divergent-code](./readability/separate-divergent-code.md) - separate code that does not execute together.
- [split-by-operation](./readability/split-by-operation.md) - split functions by coherent operation.
- [ternary-operator](./readability/ternary-operator.md) - keep conditional expressions simple.
- [visible-local-policy](./readability/visible-local-policy.md) - reduce jumps required to understand a local policy.

## Predictability

- [consistent-return-shapes](./predictability/consistent-return-shapes.md) - keep similar functions consistent in return shape.
- [hidden-logic](./predictability/hidden-logic.md) - make hidden behavior explicit.
- [operation-specific-names](./predictability/operation-specific-names.md) - use names specific enough to predict behavior.

## Cohesion

- [canonical-policy-values](./cohesion/canonical-policy-values.md) - keep a policy value in one canonical place.
- [colocate-changing-files](./cohesion/colocate-changing-files.md) - colocate files that change together.
- [state-cohesion](./cohesion/state-cohesion.md) - choose a state's cohesion level deliberately.

## Coupling

- [avoid-intermediate-state-passing](./coupling/avoid-intermediate-state-passing.md) - do not thread unrelated state through intermediate layers.
- [one-responsibility](./coupling/one-responsibility.md) - give each unit one responsibility.
- [share-after-contract-stable](./coupling/share-after-contract-stable.md) - prefer small duplication to premature sharing.

## Testing

Gate-derived rules:

- [rule-id-titles](./testing/rule-id-titles.md) - prefix rule-test descriptions with their SPEC IDs and assert concrete values.
- [reference-output](./testing/reference-output.md) - invoke the built CLI and update reference output only through the lock tool.
- [property-tests](./testing/property-tests.md) - keep P01-P05 and fix the implementation when a property finds a counterexample.
- [mutation-samples](./testing/mutation-samples.md) - treat M01-M12 expected results as complete warning-set contracts.
- [no-weak-tests](./testing/no-weak-tests.md) - reject skipped, focused, automatically updated, and meaningless tests.
- [bench](./testing/bench.md) - append measurements to the results ledger and read thresholds from TESTS.

General testing rules:

- [what-to-test](./testing/what-to-test.md) - select tests by observable risk and value.
- [test-doubles](./testing/test-doubles.md) - stub incoming data and mock outgoing effects at explicit seams.
- [test-structure](./testing/test-structure.md) - use Arrange, Act, Assert and verify one exit point.
- [test-naming](./testing/test-naming.md) - describe observable behavior in English and retain rule-ID prefixes.
- [test-anti-patterns](./testing/test-anti-patterns.md) - reject common generated tests that can pass without proving behavior.
- [coverage-and-levels](./testing/coverage-and-levels.md) - use a risk checklist, not a coverage percentage, as the acceptance line.

## Evaluation

- [numbers-from-jsonl](./eval/numbers-from-jsonl.md) - derive report numbers from run records and thresholds from configuration.
- [llm-adapter-and-cost](./eval/llm-adapter-and-cost.md) - use fake responses in tests and an explicit budget for real calls.

## Verification

- [gates-are-human-owned](./verify/gates-are-human-owned.md) - do not weaken thresholds, forbidden patterns, allowlists, or self-test expectations to obtain a pass.

## Loading these rules without path-scoped support

Claude Code loads a rule file automatically when a path you touch matches its `paths:` pattern.
Codex reads `AGENTS.md` but does not resolve `paths:` on its own, so load the matching rules yourself:

1. Read `.claude/CLAUDE.md` and this index at the start of a session.
2. Match every file you plan to change against the `paths:` patterns in the rule files listed above.
3. Read those rule files before editing.
4. Apply the readability, predictability, cohesion, and coupling rules to all TypeScript regardless of path.
5. Apply the testing rules to tests, benchmarks, and sample data.
6. Apply `scope/dependency-allowlist` to package manifests and workspace configuration.
7. Compare the files you changed against those rules once more before running verification.

Do not copy rule text into another file.
If a rule file listed here is missing, report the gap and continue with the remaining verification.
