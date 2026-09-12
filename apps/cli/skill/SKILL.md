---
name: tokenloom
description: Implement a component in this application from a Figma page export produced by the tokenloom Figma plugin. Use this whenever the user points at a tokenloom plugin export or Snapshot JSON in this project and asks to build, port, update, or check a named component or one of its variants, or asks what components an export contains, or asks for design tokens (CSS, Swift, Kotlin) from it. Also use it when the user mentions a Figma design file and a component name together, even if they do not name tokenloom. Do not use it for styling work that has no Figma export behind it.
---

# tokenloom

This Skill turns a Figma page export into design context and design tokens for one component,
so you can implement it without reading the export yourself.
The export is large and mostly irrelevant to any single component; tokenloom exists to compress it.

## The executable

Run every command through:

```
{{TOKENLOOM_COMMAND}}
```

`tokenloom init` substituted that line with the exact executable that installed this file.
Use it verbatim. Do not substitute a global `tokenloom`, an `npx` invocation, or another build:
this project is not installed from a registry, and no other build is known to be compatible with this Skill.
If the line above still reads as a literal placeholder, stop and ask the user to re-run `tokenloom init`;
guessing a command would either fail or silently run a different version.

There is no `--version` command, and an unrecognized option is rejected before anything is loaded.

## Resolving the input path

The application root is the directory holding this file's `.claude/skills/tokenloom/` directory.
Take this file's path and remove the trailing `.claude/skills/tokenloom/SKILL.md`.

- The user names the input file. Never choose one yourself: do not scan Downloads, do not take the
  newest JSON, and do not assume the only JSON in the repository is the intended one.
  Picking silently is how the wrong design gets implemented.
- Resolve a relative path the user gives against the application root, then pass the **absolute**
  path to `--from`. The CLI resolves paths against its own working directory, and you may be running
  from a nested directory, so a relative path is not reliable.
- If the user did not name a file, ask for one.
- Both the plugin export and a saved Snapshot are accepted directly by the same commands.
- Keep one implementation task on one export, unchanged for the duration of the task.
  If the user re-exports mid-task, start again from discovery rather than mixing two designs.

## Retrieving the design context

When the component name is known, retrieve it directly:

```
{{TOKENLOOM_COMMAND}} context --from <absolute-input> --view agent --json -- "<ComponentName>"
```

Useful additions:

- `--variant=<key>=<value>,...` narrows to the base plus one variant.
- `--node <id>` picks one component set when a name is carried by several.
- `--annotations` includes the designer annotations attached in Figma.
- `--level full` returns the uncompacted context; the default `compact` is what you normally want.
- Keep `--` before a component name that itself begins with `--`.

When the name is not known, list what the export offers:

```
{{TOKENLOOM_COMMAND}} context --from <absolute-input> --view agent --json
{{TOKENLOOM_COMMAND}} context --from <absolute-input> --view agent --json --match <text>
```

Discovery is deliberately bounded, so a large design system cannot flood your context.
The response carries `count`, `returned`, `truncated`, and a `next` list of the command shapes to try.
When `truncated` is `true`, narrow with `--match`; there is no pagination flag, and repeating the same
broad call returns the same truncated answer.

## Recovering from a failure

In the Agent view a selection failure is data, not a crash: a JSON body on stdout carrying
`error.code`, `error.detail`, and a `next` list, with exit status 1. Read `next` and follow it.

| `error.code` | What happened | What `next` tells you to do |
| --- | --- | --- |
| `COMPONENT_NOT_FOUND` | No component set carries that name | List the component sets and pick a real name |
| `NAME_COLLISION` | Several component sets share the name | Retry with `--node=<id>` from `error.candidates`, or list sets when the ids also collide |
| `COMPONENT_SET_EMPTY` | The set exists but holds no components | List the component sets; this one has nothing to implement |
| `VARIANT_SELECTOR_INVALID` | The selector is not `key=value` pairs, or names an unknown key | Rebuild the selector from `error.keys` |
| `VARIANT_NOT_FOUND` | No component matches the selector | Pick one of `error.available` |
| `VARIANT_AMBIGUOUS` | Several components match | Add keys until one of `error.available` is uniquely named |

A missing, unreadable, or malformed input file and a mistaken argument are different: they write
`tokenloom: <message>` to stderr with exit status 1 and produce no JSON at all.
Correct the path or the arguments rather than retrying the same call.

Stay inside the commands and selectors above. Do not invent flags or aliases, and do not fall back to
reading the export JSON directly when a call fails; that reintroduces exactly the cost this Skill removes.

## Design tokens

```
{{TOKENLOOM_COMMAND}} tokens build --from <absolute-input> --out <directory> --platform css --json
```

`--platform` accepts `css`, `swift`, `kotlin`, or a comma-separated combination, and `--out`
defaults to `dist/tokens`. Always give `--out` an explicit destination inside the project.

Whether to generate token files at all is your decision. If the application already has tokens that
carry these values, prefer reusing them and mapping the context onto them; tokenloom compares nothing
and will not tell you that a token already exists.

## Checking an input

```
{{TOKENLOOM_COMMAND}} doctor --from <absolute-input> --json
```

This reports the warning codes an input produces. Use it when a context or token result looks wrong
before assuming the design is at fault. `--strict` turns any warning into exit status 2.

## Render images

Reading an export directly writes no PNG files and returns no image reference, so nothing in a
response can point at a file that does not exist. When the user actually wants the render files on
disk, that is the separate import route:

```
{{TOKENLOOM_COMMAND}} snapshot import <export.json> --into <sample-directory>
```

## Writing the component

tokenloom stops at the design context. Where the file goes, what it is called, which styling approach
it uses, and which framework idioms apply are the application's conventions, not tokenloom's.
Read a neighboring component in this project before writing a new one, and run the project's own
build, lint, and test commands afterwards.

Report what you retrieved and what you wrote. Do not paste the export or a full context payload into
the conversation; cite the component, the variant, and the values you used.

## Exit codes

`0` success, `1` a fatal error, `2` warnings under `--strict`, `3` a network failure, `4` a reference
mismatch. No command prompts for input, so none of them will hang waiting for an answer.
