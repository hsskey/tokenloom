# real-design-system sample

This sample is an export of a published Figma Community design system, kept with the evidence needed to reproduce or audit it.
It is the largest sample in the repository and the only one that exercises a complete design system: real layer names, four button component sets, and a two-mode color collection.

## Source and license

| Field | Value |
|---|---|
| Source | Figma Community "Simple Design System" |
| URL | https://www.figma.com/community/file/1380235722331273046/simple-design-system |
| Author | Figma, Inc., through Figma Community |
| License | CC BY 4.0 |
| Copied | 2026-09-03 |
| Latest export | 2026-09-05, with `source.fetchedAt` `2026-09-05T06:31:11.984Z` |

The Community description states that Figma licenses the Simple Design System UI Kit under CC BY 4.0.
That license permits redistribution and derivative work with attribution, which this table provides.

The file matches Figma's Simple Design System repository through its component-set names `Button`, `Icon Button`, `Button Group`, and `Button Danger` and its text-style names `Title Hero`, `Title Page`, `Subtitle`, `Heading`, `Subheading`, `Body Base`, `Body Strong`, and `Body Emphasis`.

## Snapshot contents

The snapshot comes from the **Buttons** page after running the local exporter in `packages/adapters/plugin`.
The current export records:

- `source.fetchedAt`: `2026-09-05T06:31:11.984Z`
- `source.fileVersion`: `1788589871984`
- `source.plan`: `pro`
- `source.fileKey`: `<FIGMA_FILE>`
- `source.exporter.sha`: `cf81e6751f9c329bed00615801550cd4c14b2dad`
- `source.exporter.builtAt`: `2026-09-05T06:14:53Z`

The downloaded plugin export was 377,351B.
`tokenloom snapshot import` split it into a 496,766B `snapshot.json` and 53 PNG files under `render/`.
The snapshot contains 6 collections, 347 variables, 16 text styles, and 4 component sets with 53 components total.
The variables comprise 236 COLOR, 90 FLOAT, and 21 STRING values.
The component sets contain 18 `Button`, 18 `Icon Button`, 5 `Button Group`, and 12 `Button Danger` variants.
The export contains no annotations.

The importer supplied `plan` and `fileKey` because the plugin cannot discover a draft file's plan or file key.
The plugin records `unknown` and `UNKNOWN`; the import command replaces those values with `--plan` and `--file-key` input.

The first 2026-09-03 export used `fetchedAt` `2026-09-03T05:51:46.098Z` and `fileVersion` `1788414706098`.
It was 383,234B and produced a 526,423B snapshot.
That earlier exporter retained 98 hidden white fills.
The current export removes them while preserving all 53 rendered PNG bytes.

## Reference-output scope

This sample has only `reference/css/tokens.css`.
It does not define reviewed design-context, warning, token, Swift, or Kotlin reference output.
The manifest contains 55 paths for this directory: the snapshot, 53 rendered PNGs, and the CSS regression reference.
Those hashes protect integrity rather than declaring the entire sample a reviewed answer.

The sample exercises 363 real names with uppercase letters or spaces, a two-mode Color collection, and Figma-generated variant root names.
The context command must complete, but warnings are allowed.
After the current export, the command happens to produce no warnings; the earlier 18 `UNBOUND_COLOR` warnings all came from hidden white fills.

The CSS file became a regression reference on 2026-09-06 under the existing `regression baseline: tokens.css for S1` ledger reason.
It serves two checks.
The reference gate byte-compares it, so any change in the CSS emitted from this real-file snapshot fails verification.
The harness also reads it as the set of valid CSS variable names when scoring generated code (S1).
Before the file existed, all 32 run rows for this sample scored S1 zero regardless of what the model generated, because the scorer had no valid name set to compare against.

## REST comparison snapshot

`snapshot.rest.json` normalizes a REST response from the same Figma file.
It compares adapter behavior and is not reference output, so it stays outside `reference-lock`.
Its SHA-256 provenance is returned by `samples diff` as `againstSha256`.

| Field | Value |
|---|---|
| Sync date | 2026-09-05 on Professional |
| `source.plan` | `pro` |
| `source.kind` | `rest` |
| `source.fileVersion` | `2395585002880168154` |
| `source.fetchedAt` | `2026-09-05T10:29:27.815Z` |
| `source.apiVersion` | `v1` |
| `source.annotationsSupport` | `read` |
| Size | 293,072B |
| SHA-256 | `657323a52b7920d5a98a435ddba553b3a33add46f7eba5c7a38cd8eb56bc6c1c` |
| Contents | 4 component sets with 53 components, 1 text style, no variables, no collections, and no annotations |

The plugin snapshot predates `annotationsSupport`, so `samples diff` reports that additional metadata path.
The earlier 2026-09-03 Starter sync measured 293,042B with SHA-256 `10905e8fddfe9e1c43e1992f5e5d44956ffd581658ff7093ca4250973ad828b9`.

```sh
pnpm tokenloom sync --file <FIGMA_FILE> \
  --sets "Button,Icon Button,Button Group,Button Danger" \
  --expect-sets 4 --json
```

Raw REST evidence lives under `samples/captures/rest/<FIGMA_FILE>/2026-09-05/` as response bodies and headers for discovery, the node batch, and comments.
Passing those captures through `syncSnapshot` reproduces `snapshot.rest.json` byte for byte.

## Reproduce the plugin snapshot

Reproduction requires the Figma desktop app and access to the source file.
Copy the Community file to drafts, import the development plugin, run it on the Buttons page, and then run:

```sh
pnpm tokenloom snapshot import <downloaded.json> --into samples/real-design-system \
  --expect-exporter <sha> --plan pro --file-key <FIGMA_FILE>
```

Use the commit that built the exporter as `<sha>`.
The importer rejects a missing, different, or `-dirty` stamp.
Without `--plan`, the importer uses `tokenloom.config.ts`; without `--file-key`, it retains `UNKNOWN` from the plugin.

A new export changes `fileVersion`, `fetchedAt`, and `source.exporter`.
Those provenance fields are the only expected source of byte differences for otherwise identical input.
