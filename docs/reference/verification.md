# Verification contract

This document defines the verification harness.
`pnpm verify` runs every gate and writes `verify/verify-<utc>.json`.
`pnpm verify --gate <name>[,<name>]` runs a subset for diagnosis.
Only an explicit maintainer decision changes a gate contract.
When a gate appears incorrect, stop the work it covers and take an exact reproduction to a maintainer rather than weakening the gate.

## 1. Principles

- A claim of correctness is a verification record, not prose.
- Gates inspect the implementation; production code does not inspect or bypass gates.
- Reference output is locked, and the implementation must match it.
- Reference-output tests invoke the built CLI through `child_process`; a test that imports internal modules does not count toward the reference gate.
- The self-test gate verifies the verifier itself.

## 2. Gate contract

Each gate is named for the property it protects, and every gate runs on every verification.

| ID | Name | Method | Pass condition | Prevents |
|---|---|---|---|---|
| `types` | Types | Run strict root TypeScript checks and the separately configured Figma plugin project | No errors; limits for `any` casts follow verifier config; no suppression directives | Type bypasses and unchecked source |
| `patterns` | Forbidden patterns | Scan the patterns in section 3 | No violations | Hidden network calls, nondeterminism, empty catches, unfinished code, and weakened tests |
| `tests` | Tests | Run Vitest with JSON output, updates disabled, and no-test failure enabled | No failures, skips, or `.only`; test count meets the configured minimum | Snapshot updates, skipped checks, and empty suites |
| `reference` | Reference-output check | Run the built CLI, byte-diff expected test-data output, and recompute manifest hashes | No diff or unrecorded manifest change | Hand-edited expected output and internal-import tests |
| `determinism` | Determinism | Run each command twice on the original input and once after shuffling object keys and order-insensitive arrays | All three output byte streams match | Time, randomness, and order dependence |
| `properties` | Properties | Run every fast-check property and collect fresh per-ID execution counts | Every property ID passes at least 200 generated cases | Code that passes only hand-picked examples or leaves dormant property labels |
| `mutations` | Mutations | Run every case from sections 5 and 12.5 and compare complete outcomes with `expected.json` | Every case matches | Missing warnings and silent failure |
| `rules` | Rule traceability | Run `*.rules.test.ts` and match every configured SPEC rule ID to an executed test title | No missing rule ID; a skipped or todo case is not execution | Partially implemented or dormant contracts |
| `benchmarks` | Benchmarks | Apply the targets and scaling checks in section 7 | Every applicable target passes; an invalid environment is reported separately | Regressions and ignored estimates |
| `scope` | Scope | Check per-file and per-line limits, the total script LOC limit, and manifest dependencies | Limits in verifier config pass; no dependency falls outside section 9 | Unreadably long files and lines, oversized one-off scripts, and unapproved dependencies |
| `scoring` | Scorer integrity | Run adversarial scorer tests, reject hand-written report measurements, and verify trajectory score provenance against the run records and `reports/trajectory.md`, the one report path the scoring gate reads | All adversarial cases pass; report code has no forbidden number literal; `reports/trajectory.md` exists whenever non-fake trajectory run records do, does not exist without them, and states no number the records do not recompute; every adoption claim it states is a bare `adopted: <condition> @<first 12 hex of promptHash>` line whose named partition exists and whose criteria hold in that partition, and any other line naming a condition alongside `adopted` fails the gate. A row whose provenance cannot be verified, because its artifact is missing or its reference-lock commit or tokens.css hash disagrees with the current lock, is incomparable and blocks adoption rather than failing the gate by itself | A scorer that always passes, reports typed by hand, or unverifiable trajectory scores |
| `encoding` | Encoding | Require LF, UTF-8, no NUL byte, no detected line-level double encoding, and a final newline in JSON; preserve raw capture bytes | No violation | Platform-specific reference output, binary-looking source, and damaged Unicode text |
| `self-test` | Verifier self-test | Apply each intentional failure sample in an isolated copy and run its owner gate plus every required gate that overlay can change; skip a collateral gate only when the overlay paths cannot change that gate, and run every required gate when a path is unclassified. The benchmark gate remains the production-source timing probe defined below | At least one sample per gate and every outcome matches expectation | A verifier that always passes |

The configured verification duration is no more than 18 minutes.
The benchmark gate records an overrun without failing when the current machine has no valid environment baseline.

## 3. Forbidden patterns

| Pattern | Scope | Reason |
|---|---|---|
| `fetch(` | Outside `packages/adapters/rest/src` and `packages/eval/src` | Network access is confined to two packages |
| `Date.now(`, `new Date(` | `packages/{schema,parser,tokens}/src` | Determinism |
| `Math.random` | `packages/**/src`, `apps/**/src` | Determinism |
| `geometry=paths` | Entire tree | Prevent oversized REST responses |
| Empty `catch` | Entire tree | Prevent silent failure |
| `TODO`, `FIXME`, `not implemented`, `NotImplemented` | Production source | Prevent unfinished release code |
| `.only(`, `.skip(` | Tests | Prevent skipped verification |
| A rule or reference-output test whose only assertion is `toBeTruthy()`, `toBeDefined()`, or `not.toThrow()` | Rule and reference-output tests | Prevent weak assertions |
| Imports from parser or token source | Reference-output tests | Preserve black-box verification |
| `--update`, `-u` | Package scripts and Vitest configuration | Prevent automatic snapshot updates |
| Direct `JSON.stringify(` on parser or token output | Parser and token output paths | Stable key order |
| `process.exit(0)` | Production source | Prevent exit-code bypasses |

## 4. Reference-output scope

| Artifact | Scope |
|---|---|
| `reference/tokens/*.json` and `reference/css/tokens.css` | `samples/button/` |
| `reference/context.compact.json` and `reference/warnings.json` | every sample-design directory, plus `samples/mutations/expected.json` |
| `reference/swift/*` and `reference/kotlin/*` | every sample design that locks them |
| `reference/context.agent.json` | `samples/button/` |

`samples/button/*` and `samples/mutations/expected.json` are reviewed reference answers.
The remaining sample-design outputs are regression baselines generated from CLI output and identified as such in `CHANGES.md`.

`scripts/reference-lock.ts` owns five patterns: sample snapshots, reference-output trees, rendered images, mutation test data, and `eval/thresholds.json`.
Captures, REST snapshot variants, and sample-data Markdown remain tracked but are not reference-output expectations.
Use `--check` to compare the manifest.
Use `--reason "<text>"` to update the manifest and append the reason to `CHANGES.md`.
Use `--only contentHash` only when the sole change is `source.contentHash` in `context.compact.json`.

## 5. Mutation expectations

SPEC section 5.5 is canonical; `samples/mutations/expected.json` is its machine-readable copy.
The command strings below use the current `context` command.

```json
{
  "M01": { "warnings": ["UNBOUND_COLOR"], "exit": 0, "exitStrict": 2 },
  "M02": { "warnings": ["UNBOUND_DIMENSION"], "exit": 0, "exitStrict": 2 },
  "M03": { "warnings": ["UNBOUND_TYPO"], "exit": 0, "exitStrict": 2 },
  "M04": { "warnings": ["ABSOLUTE_POSITION"], "exit": 0, "exitStrict": 2 },
  "M05": { "warnings": ["UNKNOWN_NODE_TYPE"], "exit": 0, "exitStrict": 2 },
  "M06": { "cmd": "context Button", "exit": 1, "stderrIncludes": ["NAME_COLLISION", "12:34", "12:99"] },
  "M07": { "cmd": "tokens build", "warnings": ["NON_ASCII_TOKEN_NAME"], "exit": 0, "exitStrict": 2 },
  "M08": { "warnings": ["VARIANT_STRUCTURE_DIFF"], "exit": 0, "variantHasRoot": true },
  "M09": { "cmd": "tokens build", "warnings": ["ALIAS_CYCLE"], "exit": 1 },
  "M10": { "warnings": [], "exit": 0, "childrenCount": 0 },
  "M11": { "cmd": "context Button", "exit": 1, "stderrIncludes": ["no components"] },
  "M12": { "cmd": "tokens build", "warnings": [], "exit": 0, "files": ["mode.a.json", "mode.b.json", "mode.c.json", "mode.d.json"] }
}
```

When `cmd` is absent, the harness runs `context Button --from <mutation> --json`.
`warnings` requires exact set equality.

## 6. Properties

| ID | Property | Generator |
|---|---|---|
| P01 | An arbitrary RawNode tree passes the design-context schema | Bounded tree with known node types plus arbitrary strings |
| P02 | `applyDelta(base.root, variant.delta)` deep-equals the compact variant tree | Clone the base and change a bounded number of leaf values |
| P03 | Compact bytes do not exceed full bytes | Same generator as P01 |
| P04 | A bound fill prevents a `raw:` value in `style.bg` or `style.fg` | P01 plus generated variables |
| P05 | Shuffling keys and order-insensitive arrays preserves output bytes | P01 plus shuffling |

Exact generator bounds remain in the test implementation. The property gate supplies each run a unique evidence path and records the observed callback count only after fast-check succeeds, so stale files, comments, and skipped tests cannot satisfy the gate.

## 7. Benchmark targets

Current metric keys begin with `context_`; versioned readers accept historical `ir_` evidence without rewriting it.

| Measurement | Target | Method |
|---|---|---|
| Compact context warm p99 | 100ms | Synthetic test data, excluding `real-*`, with real samples recorded only |
| `tokens build` p99 | 1 second | Synthetic test data, excluding `real-*`, with real samples recorded only |
| Compact context p99 size | 8KB | Synthetic test data, excluding `real-*` |
| Median compact compression ratio | at least 15x | Synthetic test data, excluding `real-*` |
| Scaling | 1k to 10k nodes within 15x and 50MB heap | Tree generated by `packages/verify/src/synth.ts` |
| Cache | Decompress and parse a 50MB synthetic snapshot within 500ms | Brotli or Zstandard path |
| Environment probe | Stay within 1.5x of `packages/verify/baseline.json` | One allocation loop and one 10MB JSON parse before benchmarks |

Without a machine baseline, the benchmark gate decides only environment-independent measurements.

## 8. Self-test samples

Each directory under `verify/selftest/<gate>/` intentionally breaks one contract in an isolated repository copy.
The first two columns are parsed by `packages/verify/test/selftest-table.test.ts`; keep the `8. ` heading prefix and sample names stable.

| Gate | Sample | Deliberate failure |
|---|---|---|
| `types` | `any-type` | Source contains `: any` |
| `types` | `plugin-code-type-error` | Figma plugin source has a type error |
| `patterns` | `empty-catch` | Source contains an empty catch |
| `patterns` | `math-random` | Parser uses `Math.random()` |
| `tests` | `failing` | Test assertion fails |
| `tests` | `it-skip` | Test uses `it.skip` |
| `reference` | `reference-byte` | One reference CSS byte changes |
| `reference` | `manifest-only` | Only the manifest changes |
| `determinism` | `clock-in-stdout` | CLI output includes `Date.now()` |
| `properties` | `broken-applydelta` | P02 fails |
| `mutations` | `silent-unbound-color` | M01 produces no warning |
| `rules` | `missing-rule-title` | R05 disappears from rule-test titles |
| `benchmarks` | `quadratic-scale` | Stub becomes quadratic at the larger input |
| `scope` | `unlisted-dep` | Package manifest adds an unlisted dependency |
| `scoring` | `numeric-literal` | Report code contains a threshold literal |
| `encoding` | `crlf` | Text uses CRLF |
| `encoding` | `double-encoded` | A Unicode comment line is encoded twice through Latin-1 |
| `encoding` | `nul-byte` | A string literal contains a NUL byte |
| `reference` | `agent-reference-byte` | One byte of the button Agent reference changes |
| `determinism` | `agent-clock-in-output` | The CLI Agent view carries the current time |
| `properties` | `agent-mutates-canonical` | The projector mutates the canonical design context |
| `properties` | `missing-agent-property-execution` | P06 remains only as a comment after its fast-check execution is removed |
| `rules` | `missing-agent-rule-title` | A01 disappears from executed rule-test titles |
| `benchmarks` | `agent-expands-context` | The measured Agent output is larger than canonical |
| `scope` | `agent-new-unlisted-dep` | A format-experiment dependency is added without approval |
| `mutations` | `agent-empty-silent` | Zero-result discovery emits nothing |
| `scoring` | `trajectory-handwritten-number` | The trajectory report code hand-writes a success rate |

The benchmark gate runs as a collateral check only on the two `benchmarks` owner samples and on samples whose `apply/` overlay or `remove.txt` names a path under `packages/*/src`, `packages/adapters/*/src`, or `apps/*/src`.
A docs-, samples-, manifest-, or test-only sample cannot move a benchmark, so running the probe there buys no coverage and adds a timing measurement that can fail as noise.
The same reachability function skips `types`, `tests`, `reference`, `determinism`, `properties`, `mutations`, `rules`, and `scoring` when the overlay cannot change that gate: types and tests observe TypeScript, manifests, and the documents tests actually read; the CLI gates observe production source, samples, and scripts; `properties` and `rules` observe production source plus `*.props.test.ts` or `*.rules.test.ts`; `scoring` observes `packages/eval` and `reports/`. An unclassified path runs every required gate.
`patterns`, `scope`, and `encoding` always run. A skipped gate is recorded with reason `unreachable` in `skippedGates`, and benchmark skips still appear in `notRunByScope`. A skipped gate is neither a pass nor a failure and is excluded from that sample's collateral check.
`packages/verify/test/selftest-benchmark-scope.test.ts` holds the benchmark split. `packages/verify/test/meta-reachability.test.ts` holds the skip lists for the other expensive gates.
This scope is a maintainer decision; it removes a false-failure class and weakens no pass condition of any gate.

Every sample runs on every verification.
The table above and the directory tree under `verify/selftest/` must stay identical.

## 9. Dependency allowlist

The allowlist is `zod`, `citty`, `fast-check`, `vitest`, `typescript`, `tsx`, `@types/node`, `postcss`, `playwright`, `pixelmatch`, `pngjs`, `yaml`, `esbuild`, `@figma/plugin-typings`, `@figma/rest-api-spec`, `eslint`, `typescript-eslint`, `archunit` for architecture tests, and `@modelcontextprotocol/sdk` for the MCP server only.
If another package is necessary, take the case to a maintainer before changing the allowlist.

## 10. Test file conventions

| Pattern | Role | Rules |
|---|---|---|
| `*.rules.test.ts` | Rule-level tests | Put the rule ID in the title and assert a concrete value |
| `*.reference.test.ts` | Black-box reference output | Invoke only the built CLI; do not import internals |
| `*.props.test.ts` | fast-check properties | Cover the properties in sections 6 and 12.4 |
| `*.mutations.test.ts` | Mutation cases | Compare the cases from sections 5 and 12.5 with `expected.json` |
| `*.adversarial.test.ts` | Scorer defenses | Keep the adversarial case set |
| `*.bench.ts` | Benchmarks | `pnpm bench --json` appends to `bench/results.jsonl` |

Write test descriptions in English and describe an observable result.
Prefix rule-test descriptions with the required rule ID.
The fake LLM adapter returns `packages/eval/samples/fake-responses/<sample>.md` when `TOKENLOOM_LLM=fake`.
Tests and the self-test gate always use fake responses.
The test environment also sets `TOKENLOOM_NO_SPAWN`, which rejects a `claude` child immediately before spawn even if adapter selection or budget logic regresses.

## 11. `verify.json` schema

Current verification output uses `context_*` metrics; versioned readers normalize historical `ir_*` fields when comparing committed evidence.

```json
{
  "commit": "abc1234",
  "utc": "2026-09-02T10:00:00Z",
  "node": "v22.x",
  "os": "linux",
  "durationSec": 212,
  "gates": {
    "types": { "pass": true, "errors": 0, "anyCount": 2, "tsIgnore": 0 },
    "patterns": { "pass": true, "violations": [] },
    "tests": { "pass": true, "tests": 812, "failed": 0, "skipped": 0 },
    "reference": { "pass": true, "samples": 8, "diffBytes": 0, "manifestChanged": false },
    "determinism": { "pass": true, "runs": 3, "identical": true },
    "properties": { "pass": true, "properties": 9, "runsEach": 200, "counterexamples": 0 },
    "mutations": { "pass": true, "mutations": 15, "matched": 15 },
    "rules": { "pass": true, "rules": 42, "covered": 42, "missing": [] },
    "benchmarks": { "pass": true, "context_p99_ms": 41, "context_p50_ms": 25, "context_p99_bytes": 6120, "ratio_median": 22.4, "scale10x": 9.8 },
    "scope": { "pass": true, "scriptLoc": 374, "files": 62, "unlistedDeps": [] },
    "scoring": { "pass": null },
    "encoding": { "pass": true, "crlf": 0, "nul": 0, "doubleEncoded": 0 },
    "selftest": { "pass": true, "samples": 27, "asExpected": 27, "timing": { "baselinePrepareMs": 550, "baselineGatesMs": 28023, "samplePrepareMs": 14972, "parallelGatesMs": 248468, "serialBenchmarkMs": 145411, "totalMs": 437424 } }
  }
}
```

`selftest.timing` records the wall-clock split of the self-test in milliseconds: `baselinePrepareMs`,
`baselineGatesMs`, `samplePrepareMs`, `parallelGatesMs`, `serialBenchmarkMs`, and `totalMs`.
A clean-baseline failure records only the completed stages and `totalMs`.
It exists so verify cost is read from the record rather than argued.
No threshold reads it, and no gate verdict depends on it.

Set `TOKENLOOM_SELFTEST_PARALLEL` to a positive integer to override the self-test copy-pool width; unset,
empty, invalid, and non-positive values keep the default width of 4, which fits a 4-vCPU runner
without oversubscribing the copy pool. Set `TOKENLOOM_SELFTEST_VITEST_WORKERS` to a positive integer
to pass matching `--minWorkers` and `--maxWorkers` only to Vitest inside self-test copies; unset,
empty, invalid, and non-positive values leave those copies on Vitest's default. Host gates do not
read that variable. Set `TOKENLOOM_VITEST_WORKERS` to the same pair on the host process; self-test
copies ignore it so a host sweep and a copy sweep stay independent. These variables instrument
concurrency experiments and do not change gate thresholds. The self-test records the resolved
`copyPool` and `copyVitestWorkers` on the result.

`pnpm verify --gate mutations` runs one gate for diagnosis.
Only a complete `pnpm verify` run covers the whole contract.

## 12. Agent-facing context 규칙

이 절은 2절의 gate를 대체하지 않고, 코드 생성 에이전트가 직접 읽는 출력 계층에 적용되는 추가 계약을 정의한다.
새 gate를 만들지 않는다. Agent 출력의 성능은 `benchmarks`, eval/trajectory 증거의 무결성과 품질 기준은 `scoring`이 판정한다.

### 12.1 Agent 출력 규칙

| ID | 규칙 |
|---|---|
| A01 | `projectAgentContext`는 입력 `DesignContext`를 mutate하지 않고 같은 입력에서 byte-identical AgentContext를 만든다. |
| A02 | AgentContext는 top-level `version`, `source`만 제외하고 component tree, node `id`, props, base, variants, delta, token 값을 보존한다. |
| A03 | `tokensUsed`, `annotations`, `warnings`는 canonical과 값·순서가 동일하다. |
| A04 | `context`의 기본 view는 canonical이다. `--view agent`가 없으면 기존 출력 바이트가 바뀌지 않는다. |
| A05 | Agent projection과 selector는 process, file, network I/O를 수행하지 않는다. CLI/MCP는 같은 core 함수를 사용한다. |
| A06 | Variant selector는 segment별 percent encoding과 isolated UTF-16 surrogate code unit의 `%uHHHH` escape를 한 번 decode하는 `key=value,...` exact match이며 base 또는 정확히 한 Variant만 선택한다. delimiter가 있는 empty key/value는 유효하고 standalone `{}`는 own property가 없는 candidate만 선택하고 candidate own key도 known key로 판정한다. empty selector와 malformed encoding은 구조화된 invalid selector이며, 선택하지 않으면 기존 전체 context와 동일하다. |
| A07 | component discovery는 이름, node id, Variant 수로 distinguishable item의 total order를 정하고, 최대 20개 complete item과 4,096 UTF-8 serialized bytes를 모두 지키는 가장 긴 prefix를 반환한다. item당 최대 4필드이고 전체 건수와 반환 건수를 구분한다. |
| A08 | discovery zero-result와 Agent JSON 오류는 명시적인 구조를 반환한다. discovery/error에만 다음 command template을 제공한다. |
| A09 | MCP public tool은 `design_context`, `tokens` 정확히 2개이고 합산 schema 추정값은 800 token 이하이다. |
| A10 | trajectory report의 success/token/cost/duration/turn 값은 JSONL event에서 계산하며 숫자를 report code에 직접 입력하지 않는다. |
| A11 | alternate format/delta는 채택 기준을 통과한 경우에만 public contract가 된다. 실패한 실험은 결과 문서만 남기고 default contract를 바꾸지 않는다. |

A01-A11은 `docs/reference/spec.md`의 계약이고, 해당 `*.rules.test.ts` 제목에 ID를 넣어 `rules` gate가 추적한다.

### 12.2 Reference-output 범위

기존 canonical reference는 한 바이트도 자동 갱신하지 않는다.

`samples/button/reference/context.agent.json` 한 개를 **reviewed reference**로 둔다.
나머지 sample은 property/regression test로 Agent projection을 검증해 reference 복제를 과도하게 늘리지 않는다.

`reference` gate는 다음을 동시에 증명해야 한다.

1. 기존 모든 `context.compact.json` diff가 0이다.
2. built CLI의 `--view agent` 출력이 button `context.agent.json`과 byte-identical이다.
3. reference manifest 변경은 기존 `reference-lock.ts` 승인 경로를 거친다.

### 12.3 Determinism

기존 canonical command뿐 아니라 Agent view, selected Variant, discovery도 다음 세 입력에서 byte-identical이어야 한다.

- 원본 입력
- object key shuffle
- order-insensitive array shuffle

`--match` 결과 정렬 역시 입력 순서와 무관해야 한다.

### 12.4 Properties

기존 P01-P05에 아래 property를 추가한다.

| ID | Property | 핵심 검증 |
|---|---|---|
| P06 | Agent projection purity | 원본 `DesignContext` deep clone이 호출 전후 동일하고 동일 입력의 Agent bytes가 항상 같음 |
| P07 | Semantic preservation | AgentContext를 canonical과 비교했을 때 허용된 차이는 top-level `version`, `source`뿐임 |
| P08 | Variant slice correctness | 선택한 Variant를 base+delta로 복원한 tree가 canonical의 같은 Variant tree와 동일함 |
| P09 | Discovery boundedness | 입력 순서와 무관하게 정렬 결과가 같고 `returned <= 20`, `count >= returned`, truncation flag가 정확함 |

P06-P09도 bounded generator로 각각 최소 200회 실행한다.

### 12.5 Mutation/interaction cases

기존 M01-M12에 아래를 추가한다.

```json
{
  "M13": {
    "cmd": "context Button --variant size=does-not-exist --view agent --json",
    "exit": 1,
    "jsonError": "VARIANT_NOT_FOUND",
    "includes": ["available"]
  },
  "M14": {
    "cmd": "context --match definitely-no-match --view agent --json",
    "exit": 0,
    "count": 0,
    "returned": 0
  },
  "M15": {
    "cmd": "context Button --view agent --annotations --json",
    "exit": 0,
    "preserves": ["annotations", "warnings", "nodeId"]
  }
}
```

Agent JSON surface의 expected failure는 구조화하지만, 기존 canonical CLI stderr/exit contract는 바꾸지 않는다.

### 12.6 Benchmark targets

기존 compact context benchmark 기준은 유지한다. 아래는 추가 조건이다.

| Measurement | Target | Method |
|---|---:|---|
| Agent projection warm p99 | 5ms 이하 | 이미 만들어진 canonical DesignContext에 projection만 반복 |
| Agent context byte reduction median | 4% 이상 | 9개 기존 reference sample의 canonical compact 대비 |
| Per-sample Agent bytes | canonical 이하 | 9개 sample 각각 비교 |
| selected Variant reduction | 45% 이상 | `twenty-variants` 전체 context 대비 Variant 하나 중앙값 |
| discovery default output | 4KB 이하, `count` = input component set 수 | long name/id와 escaped·multibyte text를 포함한 20개 이상 component set synthetic snapshot의 unfiltered 실제 serialized UTF-8 bytes |
| discovery returned items | 최대 20 | 동일 synthetic snapshot |
| MCP tool count | 정확히 2 | `TOOLS` public schema |
| MCP schema budget | 800 estimated token 이하 | 현재 `schemaBytes` 측정 방식을 그대로 사용 |

현재 사전 측정값은 `benchmarks` 결과로 쓰지 않는다.
실제 구현 후 `pnpm bench --json`에서 다시 산출된 값만 pass/fail에 사용한다.

Agent 판정 근거는 실측 바이트와 projection 시간뿐이다.
Agent projection p99는 context p99와 같은 host-dependent 항목이므로 calibrated full mode에서 5ms 상한을 blocking으로 판정한다. partial-environment 결과는 이 timing prerequisite의 완료 근거가 아니다.
`estimateTokens(bytes)`는 바이트에서 유도한 값이므로 실제 token 절감으로 보고하지 않고 `benchmarks` 판정에도 쓰지 않는다.
실제 provider usage 기반 input token은 12.8의 trajectory 증거에서 blocking 기준으로 검증한다.
실제 LLM one-shot 측정은 인증과 비용이 필요한 선택적 evidence이며 `benchmarks` pass 조건이 아니다.

### 12.7 Architecture tests

첨부된 hexagonal guide에서 가져오는 것은 Java package 모양이 아니라 **의존성 방향, core 격리, 테스트 가능성**이다.
현재 `architecture.test.ts`에 다음을 추가한다.

- `packages/schema`는 AgentContext를 정의해도 다른 workspace package를 import하지 않는다.
- `packages/parser`의 Agent projection/Variant selector/discovery core는 schema와 parser 내부만 참조한다.
- Agent core 파일은 Node I/O, `process`, `fetch`를 사용하지 않는다.
- CLI/MCP는 별도의 projection 구현을 갖지 않는다. parser의 동일 함수를 통하거나 기존 CLI port를 통해 호출한다.
- 이 공유 경로는 core/MCP dependency graph, CLI command 경계에서 대체한 parser projector의 실행, built CLI/MCP 결과로 검증한다. import 철자나 함수 선언 문자열은 증거로 사용하지 않는다.
- `AgentSessionPort`는 child process를 import하지 않는다.
- concrete Claude session adapter만 `child_process`를 사용할 수 있고 eval의 승인된 composition 경계에서 선택한다.
- 기존 package cycle 금지는 그대로 유지한다.

runtime DI framework나 Java식 service class는 추가하지 않는다.
TypeScript structural interface와 함수 인자로 기존 seam을 유지한다.

### 12.8 Trajectory/eval integrity

`scoring` gate는 S1/S2/S3 scorer integrity에 더해 아래를 검증한다.

필수 matrix:

```text
4 tasks
× 3 conditions (cli-canonical, cli-agent, mcp-agent)
× 2 repeats
= 24 runs
```

각 run record는 최소 아래 값을 가진다.

```json
{
  "task": "known-component",
  "condition": "cli-agent",
  "success": true,
  "inputTokens": 0,
  "outputTokens": 0,
  "costUsd": 0,
  "durationMs": 0,
  "turns": 0,
  "toolCalls": [],
  "recovery": []
}
```

report는 run record를 읽어 집계하고, 결과 숫자를 직접 입력하지 않는다.
실제 run 전에는 fake adapter와 dry-run이 모두 통과해야 한다.

Agent view 채택 기준:

- task success가 CLI canonical보다 낮지 않음
- 전체 input token 중앙값 15% 이상 감소
- turns 중앙값이 증가하지 않음
- S1 하락 없음
- S2 중앙값 하락 0.02 이하
- 필수 24-run 실제 세트 총비용 $5 이하

trajectory의 input token은 provider usage 기록에서 읽는다. `estimateTokens(bytes)` 같은 바이트 유도값으로 대체하지 않는다.
Figma MCP direct 조건은 Figma quota와 외부 네트워크가 필요하므로 필수 `scoring` 증거가 아니다.
실행했다면 같은 run schema로 별도 informational section에만 집계한다.

현재 `mcp` eval input은 **Figma MCP capture의 raw tool result**라는 의미를 유지한다.
`mcp`라는 이름만 보고 tokenloom MCP와 혼동해 수치를 주장하면 안 된다.

### 12.9 Alternate format / delta 실험 규칙

Agent JSON을 baseline으로 한다.

compact text/TOON 계열 형식은 다음을 모두 만족할 때만 CLI/MCP option으로 남긴다.

- Agent JSON 대비 전체 input token 중앙값 15% 이상 감소
- task success/S1 non-regression
- S2 중앙값 하락 0.02 이하

Agent용 짧은 delta path는 Variant-heavy sample에서 Agent JSON의 RFC6901 대비 10% 이상 token을 줄일 때만 남긴다.
둘 중 하나라도 기준을 못 넘으면 experiment note에 수치와 기각 이유를 남기고 production source에서는 제거한다.

### 12.10 Scorer 해석 원칙

실파일 compact S2가 raw보다 낮았던 기존 조사 결과를 보존한다.
`raw:1px`처럼 Figma에 실제로 존재하는 unbound literal을 모델이 그대로 사용해 S2가 낮아지는 경우, parser 데이터를 지워 scorer를 맞추지 않는다.

- parser semantic fidelity 문제와 scorer 정의 문제를 분리한다.
- scorer를 바꾸려면 재현 가능한 근거를 먼저 남긴다.
- non-regression 판단은 같은 scorer version과 같은 prompt hash에서 비교한다.

### 12.11 LOC와 dependency 한도

`packages/verify/config.json`이 파일당 줄 수, 줄당 문자 수, `scripts/` 전체 줄 수 상한을 소유한다.
새 orchestration/trajectory 코드를 `scripts/`에 넣어 그 한도를 우회하지 않는다.
로직은 package에 두고 `scripts/`는 얇은 진입점으로 유지한다.

dependency allowlist는 9절이 소유한다.
새 dependency가 꼭 필요하면 maintainer 승인을 먼저 받는다.
