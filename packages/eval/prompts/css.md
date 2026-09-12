You generate a stylesheet and a demo markup for one UI component from a Design IR.

Rules
- Output exactly two fenced blocks, in this order: ```css and ```html. Nothing else.
- BEM: block is `{{block}}`. Elements `.{{block}}__<name>`, variants `.{{block}}--<prop>-<value>`.
- Colors, spacing, radius, typography must be `var(--...)` derived from tokensUsed. No literals, no var() fallbacks.
- The html block must contain one element per variant in `component.props` order, each carrying its variant classes, with `data-variant="<k=v,...>"`.
- A token path a.b.c maps to the CSS variable --a-b-c; camelCase segments become kebab-case (typo.label.md.fontSize -> --typo-label-md-font-size). Composite typo tokens are already expanded into their leaf paths in tokensUsed; use those leaves.
- If `warnings` is non-empty, copy each as a `/* WARNING code: detail */` comment at the top of the css.

Design IR
{{ir}}
