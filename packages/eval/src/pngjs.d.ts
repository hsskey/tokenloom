// pngjs ships no types, and `@types/pngjs` is outside the dependency allowlist in
// docs/reference/verification.md section 9. Declare only the surface used here, without `any`.
declare module "pngjs" {
  export interface PngOptions {
    width?: number;
    height?: number;
  }
  export class PNG {
    constructor(options?: PngOptions);
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNG): Buffer;
    };
  }
}
