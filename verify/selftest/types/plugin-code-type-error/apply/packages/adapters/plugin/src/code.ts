// Replaces the plugin source with a one-line type error. A full copy of the real file would drift, so
// the sample keeps only what the types gate needs: a file inside the separately typechecked plugin program.
const __probe: number = "x";
export { __probe };
