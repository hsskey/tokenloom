export default {
  plan: "pro" as const,
  fileKey: process.env.FIGMA_FILE,
  // Overrides only the windows and caps that the plan matrix in docs/reference/spec.md section 0 selects.
  budget: {},
  retryAfterMaxSec: 300,
  // Discovery must reach component sets nested inside sections (docs/reference/spec.md sections 0.1 and 2.1).
  discoverDepth: 4,
  // Maximum cost per capture. Configured here rather than fixed in docs/reference/spec.md section 9.3.
  captureMaxBudgetUsd: 0.5,
  categories: ["color", "space", "radius", "size", "border", "shadow", "opacity", "typo", "z"],
  patCreatedAt: "2026-09-03",
};
