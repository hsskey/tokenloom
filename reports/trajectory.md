# tokenloom trajectory

Total real cost: 8.25
Superseded rows: 13

## prompt 34fafcde2bca / model opus / resolved n/a / invocation claude -p --output-format json --restricted --model <id> --max-budget-usd <bound>

### Task success by condition (raw counts)

| Task | cli-canonical | cli-agent | mcp-agent |
| --- | --- | --- | --- |
| known-component | 2/2 | 2/2 | 2/2 |
| unknown-component | 0/2 | 1/2 | 2/2 |
| variant-only | 2/2 | 2/2 | 2/2 |
| recovery | 1/2 | 0/1 short | - |
| All tasks | 5/8 | incomplete | incomplete |

### Per-condition diagnostics (medians over each condition's own runs; not the comparison)

| Condition | Primary | Runs | Incomparable | Missing runs | Total input p50 | Output p50 | Duration ms p50 | Turns p50 | Tool calls | Recoveries | Cost p50 | S1 p50 | S2 p50 | Coverage p50 | S3 p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cli-canonical | yes | 8 | 0 | 0 | 46935 | 849 | 26057 | 3 | 29 | 22 | 0.19 | 0.00 | 1.00 | n/a | n/a |
| cli-agent | yes | 7 | 0 | 1 | 45660 | 938 | 19402 | 3 | 13 | 3 | 0.14 | 1.00 | 1.00 | n/a | n/a |
| mcp-agent | yes | 6 | 0 | 2 | 45677 | 1061 | 19359 | 3 | 10 | 2 | 0.11 | 0.00 | 1.00 | n/a | n/a |
| cli-agent-compact | no | 6 | 0 | 2 | 46235 | 1138 | 19244 | 3 | 10 | 2 | 0.12 | 1.00 | 1.00 | n/a | n/a |

Total input is inputTokens + cacheCreation + cacheRead, summed over the turns of a run.
## prompt 3d7bfc957c1a / model opus / resolved claude-opus-4-8 / invocation claude -p --output-format stream-json --verbose --restricted --model <id> --max-budget-usd <bound>

### Task success by condition (raw counts)

| Task | cli-canonical | cli-agent | mcp-agent |
| --- | --- | --- | --- |
| known-component | 2/2 | 2/2 | 2/2 |
| unknown-component | 1/2 | 2/2 | 2/2 |
| variant-only | 2/2 | 2/2 | 1/2 |
| recovery | 2/2 | 1/2 | 2/2 |
| All tasks | 7/8 | 7/8 | 7/8 |

### Per-condition diagnostics (medians over each condition's own runs; not the comparison)

| Condition | Primary | Runs | Incomparable | Missing runs | Total input p50 | Output p50 | Duration ms p50 | Turns p50 | Tool calls | Recoveries | Cost p50 | S1 p50 | S2 p50 | Coverage p50 | S3 p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cli-canonical | yes | 8 | 0 | 0 | 28887 | 847 | 20317 | 2 | 22 | 14 | 0.21 | 0.00 | 1.00 | 1.00 | n/a |
| cli-agent | yes | 8 | 0 | 0 | 28589 | 1335 | 18891 | 2 | 13 | 3 | 0.12 | 0.00 | 1.00 | 1.00 | n/a |
| mcp-agent | yes | 8 | 0 | 0 | 29773 | 1178 | 22408 | 2 | 13 | 2 | 0.12 | 0.00 | 0.91 | 1.00 | n/a |

Total input is inputTokens + cacheCreation + cacheRead, summed over the turns of a run.
