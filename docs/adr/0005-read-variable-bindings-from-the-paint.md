# Read variable bindings from the paint, not the node

Both Figma input paths expose a variable binding for a fill or stroke color in two places: on the paint itself as `boundVariables.color`, and on the node as a `boundVariables.fills` or `boundVariables.strokes` array.
Only the first is a documented, typed pairing.
The node-level array has no index contract with the paint list, so a hidden or reordered paint silently shifts every binding after it.

tokenloom reads the paint's own binding first and falls back to the node-level array by index only when the paint carries none.
Paints and their bindings are filtered together, so removing a hidden paint removes its binding with it and the remaining pairs stay aligned.

The Plugin exporter duplicates this pairing rather than importing the schema helper: importing it would pull Zod into the plugin bundle and grow it from 12.4 KB to 153 KB, which the Figma runtime pays on every export.
The duplication is deliberate and small; `docs/reference/spec.md` section 4.1 is the contract both copies implement.
