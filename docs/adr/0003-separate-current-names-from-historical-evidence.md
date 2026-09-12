# Keep current names separate from historical evidence

Current source, CLI commands, MCP tools, and reference-output filenames use design context and evaluation input variant without legacy aliases.
Immutable historical run records retain the field names written by their original schema and are interpreted only at versioned read boundaries.
Rewriting committed evidence would break reproducibility without changing its meaning, so compatibility belongs in readers of archived data rather than the current public interface.
