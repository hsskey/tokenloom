# @hsskey/tokenloom

Give coding agents only the Figma context they need to implement a component.

tokenloom turns a Figma page export into component-level design context and reusable design tokens
for CSS, Swift, and Kotlin. The transformation runs locally and deterministically and does not call
a language model.

```sh
npm install -g @hsskey/tokenloom
tokenloom --help
```

Node.js 22 or later is required. Installing exposes the `tokenloom` command.

```sh
tokenloom init                                   # install the Claude Code Skill in your project
tokenloom context Button --from designs/checkout.json --view agent --json
tokenloom tokens build --from designs/checkout.json --out src/tokens --platform css,swift,kotlin
```

Export a page with the **tokenloom exporter** Figma plugin to produce the input snapshot.

This package ships the `dist/tokenloom.js` bundle and the Skill template that `tokenloom init`
installs. The sources, sample designs, and regression harness live in the repository.

- English: https://github.com/hsskey/tokenloom
- Korean: https://github.com/hsskey/tokenloom/blob/main/README.ko.md
