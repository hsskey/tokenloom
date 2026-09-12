# Generating component code

This describes generating component code on request, outside the regression harness in `packages/eval`.

1. Use only the output of `pnpm tokenloom context <Name> --annotations --view agent --json` as design input. See `docs/reference/spec.md` section 4.11 for the Agent context contract.
2. Do not call the Figma MCP server directly for the same generation task; the design context already carries what the generator needs.
3. Read color, spacing, and typography from the `tokensUsed` references rather than writing literal values.
4. Use BEM class names and CSS custom properties for web output.
5. Do not add a framework runtime dependency.
6. Copy the design-context warnings into comments at the top of the generated code, so the reader sees what the source design left unresolved.
