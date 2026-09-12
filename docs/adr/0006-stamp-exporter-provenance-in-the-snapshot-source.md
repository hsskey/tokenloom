# Stamp exporter provenance in the snapshot source block

A snapshot exported by an old plugin bundle is indistinguishable from a current one by content alone, so a stale export can look like a parser regression.
The exporter therefore records which bundle produced it.

The stamp is fixed at bundle build time, not at export time, because the answer has to be the commit the running code came from rather than the clock of the Figma session that ran it.
It lives in `Snapshot.source`, beside `fetchedAt`, and never in design context or token output: those are byte-compared against reference output and must not carry build identity.

`Snapshot.source.exporter` is optional.
Snapshots captured before the stamp existed keep parsing, and the loader does not reject an unstamped snapshot.
The single place that checks provenance is `snapshot import`.

The plugin is typechecked as its own TypeScript program rather than merged into the root program, because `@figma/plugin-typings` declares plugin globals ambiently and merging the two would leak those globals into every other package.
Reversal signal: if those typings stop declaring globals, or `code.ts` stops using them, merge the programs.
