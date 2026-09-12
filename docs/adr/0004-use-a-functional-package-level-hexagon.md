# Use a functional package-level hexagon

This ADR documents the existing inward dependency direction and makes its technology seams explicit.
Schema, parser, and token packages remain the core; CLI, MCP, Figma, child-process, runtime-HTTP, and file persistence stay in adapters or composition roots.

A literal translation of the reviewed Java guide would introduce roughly eight to twelve ports and move fifteen to twenty-five files into domain, application, infrastructure, and bootstrap layers.
The selected TypeScript adaptation needs four explicit port or policy seams and changes about six to ten source files because it follows the variation already present in this CLI.
It retains function-first orchestration, structural types, Zod validation, and package interfaces that already hide substantial behavior.

ArchUnitTS enforces dependency direction and cycles through the existing test command.
The change adds no network request, filesystem traversal, or runtime operation to tokenloom commands.

See `docs/architecture.md` for the package map and enforced rules.
