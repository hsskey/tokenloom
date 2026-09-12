// pixelmatch 6 ships no types, and `@types/pixelmatch` is outside the dependency allowlist in
// docs/reference/verification.md section 9. Declare only the surface used here.
declare module "pixelmatch" {
  export interface PixelmatchOptions {
    threshold?: number;
    includeAA?: boolean;
    alpha?: number;
  }
  export default function pixelmatch(
    img1: Buffer | Uint8Array,
    img2: Buffer | Uint8Array,
    output: Buffer | Uint8Array | null,
    width: number,
    height: number,
    options?: PixelmatchOptions,
  ): number;
}
