import type { AgentContextT, DesignContextT } from "@tokenloom/schema";

/**
 * Project a canonical design context onto the Agent view (docs/reference/spec.md section 4.11).
 * A01 and A05: the input is never mutated and no process, file, or network access happens here.
 * A02 and A03: only the top-level `version` and `source` are dropped, so every remaining value
 * and its order stay canonical. Listing the kept keys makes a future DesignContext key a
 * compile error here rather than a silent pass-through.
 */
export function projectAgentContext(context: DesignContextT): AgentContextT {
  return {
    component: context.component,
    tokensUsed: context.tokensUsed,
    annotations: context.annotations,
    warnings: context.warnings,
  };
}
