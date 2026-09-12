# tokenloom

tokenloom turns normalized design data into portable token output and component-specific context for code generation.

## Language

**Sample design**:
A reusable example design included to demonstrate tokenloom behavior or exercise a documented scenario.
_Avoid_: Fixture in user-facing prose.

**Snapshot**:
A normalized design input that isolates tokenloom from the shape of a Figma transport response.
_Avoid_: Export, payload, or fixture when referring to the normalized artifact.

**Design context**:
The component-specific structure, variants, token bindings, and optional annotations supplied to a code generator.
_Avoid_: IR, Design IR, intermediate representation.

**Design node**:
A component or nested element represented inside design context.
_Avoid_: IR node.

**Token set**:
The normalized design values that tokenloom emits as DTCG JSON and platform-specific source.
_Avoid_: Variables when referring to the complete cross-platform output.

**Input source**:
The route by which design data enters an evaluation run: a normalized snapshot or an MCP response.
_Avoid_: Input kind.

**Context level**:
The amount of detail returned by the CLI design-context command: compact or full.
_Avoid_: IR level in current prose.

**Evaluation input variant**:
The representation compared by an evaluation run: raw input, compact design context, or compact design context with annotations.
_Avoid_: Context level or IR level when describing experiment matrix rows.

**Evaluation run**:
One immutable generated-code experiment, including its input source, evaluation input variant, output, scores, and measured usage.
_Avoid_: Run record or result row in current product prose.

**Reference output**:
Reviewed expected token or design-context output for a sample design, used for byte-level regression comparison.
_Avoid_: Golden, golden file.

**Trajectory run**:
One immutable whole-task experiment in which a model queries tokenloom until the task is done, including its interface condition, turns, tool calls, recoveries, and measured usage.
_Avoid_: Session, agent loop, or evaluation run when referring to the multi-turn measurement.

**Interface condition**:
The tokenloom surface a trajectory run queries: the CLI canonical view, the CLI agent view, or the MCP agent view.
_Avoid_: Mode, channel, or variant when describing which surface answered a query.

**Turn**:
One model invocation inside a trajectory run, billed with the whole transcript that precedes it.
_Avoid_: Step, iteration, or round trip.

**Tool call**:
One query the harness executed on the model's behalf, recorded with the turn that requested it.
_Avoid_: Function call or native tool call, which name a provider mechanism tokenloom does not measure.

**Recovery**:
A point where a trajectory run received a failed query and reached a working one, recorded with the error code that caused it.
_Avoid_: Retry or fallback, which do not say whether the run recovered.
