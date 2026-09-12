import { describe, expect, it } from "vitest";

describe("selftest", () => {
  it.skip("건너뛴 테스트", () => {
    expect(1).toBe(1);
  });
});
