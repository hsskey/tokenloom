# tokenloom trajectory

Total real cost: 4.14

## prompt 34fafcde2bca / model opus / invocation claude -p --output-format json --restricted --model <id> --max-budget-usd <bound>

| Condition | Runs | Incomparable | Success rate | Total input p50 | Output p50 | Duration ms p50 | Turns p50 | Tool calls | Recoveries | Cost p50 | S1 p50 | S2 p50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cli-canonical | 8 | 0 | 0.63 | 46935 | 849 | 26057 | 3 | 29 | 22 | 0.19 | 0.00 | 1.00 |
| cli-agent | 7 | 0 | 0.71 | 45660 | 938 | 19402 | 3 | 13 | 3 | 0.14 | 1.00 | 1.00 |
| mcp-agent | 6 | 0 | 1.00 | 45677 | 1061 | 19359 | 3 | 10 | 2 | 0.11 | 0.00 | 1.00 |
| cli-agent-compact | 6 | 0 | 1.00 | 46235 | 1138 | 19244 | 3 | 10 | 2 | 0.12 | 1.00 | 1.00 |

Total input is inputTokens + cacheCreation + cacheRead, summed over the turns of a run.
