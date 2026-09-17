export interface ChildOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export type ChildRun = (command: string, args: string[], cwd: string) => Promise<ChildOutput>;

export const NO_SPAWN_ENV = "TOKENLOOM_NO_SPAWN";

export interface LlmUsage {
  inputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ProviderCallEvidence {
  format: "json" | "stream-json";
  // A session setting, not proof of which model produced the returned text (SPEC 9.1).
  initModel: string | null;
  assistantModels: string[];
  modelUsage: Record<string, unknown>;
}

export type ModelResolution = "producing-message" | "sole-model-usage-key";

export interface HarnessCommit {
  sha: string;
  dirty: boolean;
}

export interface LlmResult extends LlmUsage {
  text: string;
  // Resolved provider ID when one is authoritative, otherwise the requested alias (SPEC 9.1).
  model: string;
  requestedModel: string;
  resolvedModel: string | null;
  modelResolution: ModelResolution | null;
  providerEvidence: ProviderCallEvidence | null;
  ms: number;
  invocation: string;
  error?: string;
}

export interface LlmAdapter {
  readonly kind: "fake" | "claude";
  run(prompt: string, context: { sampleName: string; model: string; repoRoot: string }): Promise<LlmResult>;
}
