# Build the Figma exporter from source

This is the contributor guide. It builds the exporter from this repository, loads that build into
the Figma desktop app, exports a page, and converts the export into a tokenloom snapshot.
Use it when changing the exporter or capturing a new sample design; ordinary users install the
**tokenloom exporter** plugin from Figma Community instead.

The exporter reads the variables, text styles, and component data that tokenloom needs from a real
file. It is the only supported real-file path that can read variables on a free Figma plan, because
the Variables REST API requires Enterprise access.

## Manifest

Figma loads `packages/adapters/plugin/manifest.json`.

| Field | Value | Purpose |
|---|---|---|
| `name` | `tokenloom exporter` | Name shown in the Plugins menu |
| `id` | `tokenloom-exporter` | Plugin identifier |
| `api` | `1.0.0` | Plugin API version |
| `main` | `dist/code.js` | Bundled plugin code |
| `ui` | `src/ui.html` | Single-action export UI |
| `editorType` | `["figma"]` | Limit the plugin to Figma design files |
| `documentAccess` | `dynamic-page` | Load only the current page on demand |
| `networkAccess` | `{ "allowedDomains": ["none"] }` | Keep the exporter offline |

## Build the plugin

From the repository root, install pinned dependencies and build the plugin:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @tokenloom/plugin build
```

TypeScript checks the plugin with `@figma/plugin-typings`, then esbuild writes `packages/adapters/plugin/dist/code.js` as one IIFE bundle.
The bundle records two provenance values in every export:

- `__TL_EXPORTER_SHA__` is the current Git revision.
- `__TL_EXPORTER_BUILT_AT__` is the UTC build time.

A build from a dirty worktree appends `-dirty` to the revision.
The generated `dist/` directory is ignored by Git.

Build the separate CLI bundle with:

```sh
pnpm build
```

## Load your build into Figma

Loading a local build requires the Figma desktop app.

1. Open **Plugins > Development > Import plugin from manifest**.
2. Select `packages/adapters/plugin/manifest.json`.
3. Open the page you want to export.
4. Run **Plugins > Development > tokenloom exporter**.
5. Choose **Export this page**, then **Download snapshot**.

The exporter reads only the current page.
Run it once per page when a file contains several pages.
Rendered component-set PNGs are embedded as `renderPngBase64`, so the downloaded JSON can be large.

## Import the exported snapshot

Convert the downloaded JSON into a normal tokenloom snapshot:

```sh
pnpm tokenloom snapshot import <downloaded.json> --into snapshots/<name>
```

The importer writes `snapshot.json` and extracts each embedded PNG to `render/<id>.png`.

For reproducible test-data authoring, require the exporter revision that you built:

```sh
pnpm tokenloom snapshot import <downloaded.json> \
  --into samples/<name> \
  --expect-exporter "$(git rev-parse HEAD)"
```

The provenance check exits with code 1 when the revision is absent, does not match, or ends in `-dirty`.
Without `--expect-exporter`, the importer prints the embedded revision without enforcing it.

Two source fields can change between exports of the same Figma page: `source.fileVersion` and `source.fetchedAt`.
All normalized content derived from one imported snapshot remains deterministic.

## Related documentation

- `README.md` shows the complete token and design-context workflow.
- `docs/reference/spec.md` section 0 documents Figma plan capabilities and limits.
- `docs/reference/spec.md` section 4.9 defines the `snapshot import` contract and exit codes.
- `samples/AUTHORING.md` documents hand-authored synthetic test data.
- `samples/real-design-system/README.md` records the provenance of one real-file sample design.
