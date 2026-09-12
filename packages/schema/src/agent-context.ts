import type { z } from "zod";
import { DesignContext } from "./design-context";

/**
 * Agent view of a design context (docs/reference/spec.md section 4.11, rule A02).
 * Derived from DesignContext so component trees, node ids, deltas, token values, annotations,
 * and warnings cannot drift from the canonical contract.
 */
export const AgentContext = DesignContext.omit({ version: true, source: true });

export type AgentContextT = z.infer<typeof AgentContext>;
