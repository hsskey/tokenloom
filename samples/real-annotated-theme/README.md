# real-annotated-theme sample

This sample is a small maintainer-authored Figma file that exercises two real-file paths no other sample covers together: light and dark native output, and Dev Mode annotations.

## Source and license

| Field | Value |
|---|---|
| Source | Maintainer-authored Figma file, named `tokenloom-real-2` at creation |
| Author | Repository maintainer |
| License | Same as this repository; no external attribution requirement |
| File key | Written as `<FIGMA_FILE>` in this document; the real value is in `snapshot.json`, `snapshot.rest.json`, and the `samples/captures/rest/` directory name |
| Created | 2026-09-05 |
| Latest export | 2026-09-05, with `source.fetchedAt` `2026-09-05T09:51:24.333Z` |

Unlike `real-design-system`, this file does not derive from a Community resource.

## Snapshot contents

The sample exercises two paths:

| Path | Contract | `real-design-system` | This sample |
|---|---|---|---|
| Light and dark native output | O07 | SDS Light and SDS Dark | theme Light and Dark |
| Dev Mode annotations | Section 4.8 | No annotations | 2 `devmode` annotations |

Neither real file exercises `MODE_COLLAPSED` because this file has only one mode in its `space` collection.
The `samples/four-modes` synthetic sample covers that branch.

The snapshot contains 2 collections, 6 variables, 1 text style, 1 component set, 2 variants, and 2 Dev Mode annotations.
The variables comprise 4 COLOR and 2 FLOAT values.
The original plugin export was 8,794B; import produced a 9,393B snapshot and 2 rendered PNGs.

The exporter stamp is `e01a14590cfc3915e2f3ec694f4613cb75d75d70`, built at `2026-09-05T09:37:26Z`.
`source.annotationsSupport` is `read`.
That value means the plugin runtime exposed the annotation property; `unsupported` would identify a runtime or plan limitation rather than an empty file.

The importer supplied the known plan and file key because the plugin cannot discover them for a draft file.

## Regression references

Unlike `real-design-system`, this sample contains a complete `reference/` tree.
It is generated regression output rather than a maintainer-authored answer.
It detects silent changes in light/dark output and annotation handling.
Only `samples/button` contains reviewed reference output defined directly by the specification.

## REST comparison snapshot

`snapshot.rest.json` normalizes a REST response from the same file and stays outside `reference-lock`.
Its SHA-256 value records provenance.

| Field | Value |
|---|---|
| Sync date | 2026-09-05 on Professional |
| `source.plan` | `pro` |
| `source.kind` | `rest` |
| `source.fileVersion` | `2395642804999070852` |
| `source.fetchedAt` | `2026-09-05T10:32:13.152Z` |
| `source.apiVersion` | `v1` |
| `source.annotationsSupport` | `read` |
| Size | 5,920B |
| SHA-256 | `13ea20db36e0f90a20364a11a43383280a7d2932b95726eb7b131d4054dac0ae` |
| Contents | 1 component set with 2 components, 1 text style, no variables, no collections, and 2 annotations |

```sh
pnpm tokenloom sync --file <FIGMA_FILE> --sets "Button" --expect-sets 1 --json
```

Raw REST bodies and headers live under `samples/captures/rest/<FIGMA_FILE>/2026-09-05/`.
The comments response is empty, but the node-batch response carries 2 Dev Mode labels on nodes `1:10` and `1:13` that normalize to the same annotation text as the plugin export.

## Reproduce the plugin snapshot

Reproduction requires the Figma desktop app and access to the maintainer-authored file.
Import `packages/adapters/plugin/manifest.json`, run the exporter, and then run:

```sh
pnpm tokenloom snapshot import <downloaded.json> --into samples/real-annotated-theme \
  --expect-exporter <sha> --plan pro --file-key <FIGMA_FILE>
```

Use the commit that built the exporter as `<sha>`.
The importer rejects a missing, different, or `-dirty` stamp.
If annotations are expected but `source.annotationsSupport` is `unsupported`, check the Figma plan and Plugin API runtime before the file content.

A new export changes `fileVersion`, `fetchedAt`, and `source.exporter`.
Those provenance fields are the only expected source of byte differences for otherwise identical input.
