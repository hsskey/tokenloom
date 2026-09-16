# Pipeline pull request bodies

Pull requests opened by the `no-mistakes` validation pipeline are composed by the tool, not from `.github/PULL_REQUEST_TEMPLATE.md`.
That repository template governs pull requests written by hand in the GitHub UI.
The observations below are for the installed `no-mistakes` v1.60.2; a newer release exists, but updating it is out of scope here and is not assumed.

## What composes the body

The `no-mistakes` binary composes the body itself.
It is not an agent prompt and not a repository file, so it cannot be steered from this repository.
The `pr` step emits a fixed section order:

1. `## Intent`
2. `## What Changed`
3. `## Risk Assessment`
4. `## Testing` (only when the host description budget allows)
5. `## Pipeline`

Only `## What Changed` is written by the pipeline agent, as one to three concise bullets.
The `pr`-step prompt states that the binary adds `## Intent`, `## Risk Assessment`, `## Testing`, and `## Pipeline` separately, and instructs the agent not to write them.
`## Intent` reproduces the run intent verbatim, preserving it exactly.

## Why the repository template does not apply here

The basis is the fixed formatter itself: the built-in section strings and the `pr`-step prompt that scopes the agent to `## What Changed` and adds the other sections around it.
In `no-mistakes` v1.60.2 the supported configuration surface exposes no key that selects a pull request template or renames or reorders these sections; the `pr.*` configuration is limited to `pr.base_branch`, and the repository-scoped config file is `.no-mistakes.yaml`.
No reference to `.github/PULL_REQUEST_TEMPLATE.md` was found in the binary, which is consistent with the tool building its own structure.
On this version the control is absent, not misconfigured: no project change makes a pipeline PR carry the `Why` / `What changed` / `How I checked` / `What I left alone` headings, and the agent prompt reaches only `## What Changed`.

## Consequences to expect on pipeline PRs

- Section headings differ from the human template. This is the tool's fixed structure, not a mistake by the generating agent.
- `## Intent` is the run intent reproduced verbatim, so it appears in whatever language the intent was written in. The workflow preserves the exact authorized intent; rendering it in English is a separate translation or summarization step for whatever presents the PR, not a change to the intent input.
- `## Testing` links local filesystem paths when test evidence is not published. `test.evidence.store_in_repo` would instead commit artifacts into the repository, which this project does not do so that evidence and private payloads stay out of the tree.

## Bounded remedy

- Keep `## What Changed` concise, in English, and free of private paths. It is the only agent-authored field and is best-effort at run time, not a durable guarantee.
- Preserve the pending, failed, and skipped distinctions the `## Testing` and `## Pipeline` sections carry. They are tool-owned and must not be flattened by a later manual correction.
- Full conformance to the repository template on pipeline PRs would require an upstream change in `no-mistakes` (honor `.github/PULL_REQUEST_TEMPLATE.md`, or add a section or template configuration key). That is a request to raise with the tool's maintainers under the appropriate authority, not something this repository works around with a wrapper or a manual review layer.

## Verification

The observations above are read from the installed `no-mistakes` v1.60.2: the built-in section strings and the `pr`-step prompt that scopes the agent to `## What Changed`, plus the configuration surface, whose only `pr.*` key is `pr.base_branch`.
No reference to `PULL_REQUEST_TEMPLATE` was found in the binary.
This positive format evidence is sufficient for the current limitation; no pipeline run is needed to confirm it, and none should be started only to inspect formatting.
